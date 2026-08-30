/**
 * Integration — the REFERRED-patient journey through the real service layer:
 * referral created with an SLA deadline → acknowledged by the receiving
 * facility → intake recorded on the receiving side → completed with an
 * outcome handed back to the sender.
 *
 * The research feeding this module names the two failure points African
 * referral systems replicate everywhere: no counter-referral feedback, and no
 * intake step on arrival. Both halves are pinned here (recordReferralIntake
 * and completeReferralWithOutcome — the latter's outcome note IS the
 * counter-referral).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import {
  createReferral, updateReferralStatus, recordReferralIntake,
  completeReferralWithOutcome, getReferralById, getOverdueReferrals, isReferralOverdue,
} from '@/lib/services/referral-service';
import { hospitalsDB } from '@/lib/db';
import type { ReferralDoc } from '@/lib/db-types';

const ORG = 'org-moh-ss';

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: 'hosp-001', type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG } as unknown as { _id: string });
  await putDoc(hospitalsDB(), { _id: 'hosp-002', type: 'hospital', name: 'Wau State Hospital', code: 'WSH', orgId: ORG } as unknown as { _id: string });
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

function referralInput(overrides: Partial<ReferralDoc> = {}) {
  return {
    patientId: 'pat-00001', patientName: 'Deng Mabior Garang',
    fromHospital: 'Juba Teaching Hospital', fromHospitalId: 'hosp-001',
    toHospital: 'Wau State Hospital', toHospitalId: 'hosp-002',
    referralDate: '2026-08-29', urgency: 'urgent' as const,
    reason: 'Surgical consultation — acute abdomen', department: 'Surgery',
    status: 'sent' as const, referringDoctor: 'Dr. James Wani Igga',
    notes: 'Guarding and rebound tenderness; ultrasound unavailable here',
    ...overrides,
  } as unknown as Parameters<typeof createReferral>[0];
}

test('referral → acknowledgement → intake → outcome closes the loop', async () => {
  const ref = await createReferral(referralInput());

  // The SLA deadline is stamped from urgency (urgent = +24h) and is not yet
  // breached.
  expect(ref.expectedAt).toBeTruthy();
  expect(isReferralOverdue(ref, new Date())).toBe(false);
  const hoursOut = (new Date(ref.expectedAt!).getTime() - new Date(ref.createdAt).getTime()) / 3_600_000;
  expect(Math.round(hoursOut)).toBe(24);

  // Receiving facility acknowledges.
  await updateReferralStatus(ref._id, 'received');

  // Intake creates the receiving-side record once, idempotently.
  const received = (await getReferralById(ref._id))!;
  const intake = await recordReferralIntake(received, ORG);
  expect(intake?.visitType).toBe('referral');
  expect(intake?.hospitalId).toBe('hosp-002');
  expect(intake?.chiefComplaint).toContain('acute abdomen');
  expect(await recordReferralIntake(received, ORG)).toBeNull(); // second call: no duplicate

  // Outcome completes the referral and writes the counter-referral note the
  // sending clinician reads.
  const completed = await completeReferralWithOutcome(ref._id, {
    disposition: 'treated_admitted',
    summary: 'Appendicectomy performed; recovering on surgical ward.',
    followUp: 'Suture removal day 7 at referring facility.',
    recordedBy: 'Dr. Achol Mayen Deng',
    recordedAt: new Date().toISOString(),
  } as unknown as Parameters<typeof completeReferralWithOutcome>[1]);
  expect(completed?.status).toBe('completed');
  expect(completed?.outcome?.summary).toContain('Appendicectomy');
  expect(completed?.notes).toContain('OUTCOME');
  expect(completed?.notes).toContain('Follow-up');
});

test('an unacknowledged referral past its SLA surfaces as overdue', async () => {
  const ref = await createReferral(referralInput());
  const past = new Date(new Date(ref.expectedAt!).getTime() + 60 * 60 * 1000); // 1h past deadline

  expect(isReferralOverdue(ref, past)).toBe(true);
  const overdue = await getOverdueReferrals(undefined, past);
  expect(overdue.map(r => r._id)).toContain(ref._id);

  // Once acknowledged, it stops counting as overdue even past the deadline.
  await updateReferralStatus(ref._id, 'received');
  const after = (await getReferralById(ref._id))!;
  expect(isReferralOverdue(after, past)).toBe(false);
});
