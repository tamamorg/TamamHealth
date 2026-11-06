/**
 * Voiding a birth/death (never a delete) and discarding a HELD assessment.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-vvuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB } from '@/lib/db';
import { createBirth, getAllBirths, getBirthStats, voidBirth, VitalVoidError } from '@/lib/services/birth-service';
import { createDeath, getAllDeaths, getDeathStats, voidDeath } from '@/lib/services/death-service';
import { createAssessment, getAssessmentsByPatient, getHeldAssessments, signAssessment, discardAssessment, updateAssessmentAnswers, AssessmentLockError } from '@/lib/services/assessment-service';
import { ASSESSMENT_INSTRUMENTS } from '@/lib/clinical/assessment-instruments';
import { buildBirthNotificationHtml, buildDeathCertificateHtml, VoidedRecordError } from '@/lib/vital-certificates';
import type { DataScope } from '@/lib/services/data-scope';

const SCOPE: DataScope = { orgId: 'org-a', hospitalId: 'hosp-a1', role: 'clinician' as DataScope['role'] };
const actor = { userId: 'u1', userName: 'Records Officer' };

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: 'hosp-a1', type: 'hospital', name: 'A', orgId: 'org-a' } as never);
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const birth = (o: Record<string, unknown> = {}) => ({
  childFirstName: 'Baby', childSurname: 'One', childGender: 'Male', dateOfBirth: '2026-10-01',
  motherName: 'Mother One', facilityId: 'hosp-a1', facilityName: 'A', state: 'CES', certificateNumber: 'B-1', ...o,
}) as unknown as Parameters<typeof createBirth>[0];
const death = () => ({
  deceasedFirstName: 'D', deceasedSurname: 'One', deceasedGender: 'Male', dateOfDeath: '2026-10-01', ageAtDeath: 40,
  immediateCause: 'x', facilityId: 'hosp-a1', facilityName: 'A', state: 'CES', certificateNumber: 'D-1',
}) as unknown as Parameters<typeof createDeath>[0];

describe('voidBirth', () => {
  it('requires a reason', async () => {
    const b = await createBirth(birth(), SCOPE);
    await expect(voidBirth(b._id, '  ', actor)).rejects.toBeInstanceOf(VitalVoidError);
  });
  it('keeps the document, hides it, and drops it from stats', async () => {
    const b = await createBirth(birth(), SCOPE);
    await createBirth(birth({ certificateNumber: 'B-2' }), SCOPE);
    const v = await voidBirth(b._id, 'duplicate', actor);
    expect(v).toMatchObject({ voidReason: 'duplicate', voidedBy: 'u1', voidedByName: 'Records Officer' });
    expect(v!.voidedAt).toBeTruthy();
    expect((await getAllBirths(SCOPE)).map(x => x._id)).not.toContain(b._id);
    expect((await getAllBirths(SCOPE, { includeVoided: true })).map(x => x._id)).toContain(b._id);
    expect((await getBirthStats(SCOPE)).total).toBe(1);
  });
  it('refuses a second void and certificate output', async () => {
    const b = await createBirth(birth(), SCOPE);
    const v = (await voidBirth(b._id, 'error', actor))!;
    await expect(voidBirth(b._id, 'again', actor)).rejects.toBeInstanceOf(VitalVoidError);
    expect(() => buildBirthNotificationHtml(v)).toThrow(VoidedRecordError);
    expect(() => buildBirthNotificationHtml(b)).not.toThrow();
  });
});

describe('voidDeath', () => {
  it('hides, excludes from stats, refuses certificate', async () => {
    const d = await createDeath(death(), SCOPE);
    await expect(voidDeath(d._id, '', actor)).rejects.toBeInstanceOf(VitalVoidError);
    const v = (await voidDeath(d._id, 'entered in error', actor))!;
    expect(v.voidReason).toBe('entered in error');
    expect(await getAllDeaths(SCOPE)).toHaveLength(0);
    expect(await getAllDeaths(SCOPE, { includeVoided: true })).toHaveLength(1);
    expect((await getDeathStats(SCOPE)).total).toBe(0);
    expect(() => buildDeathCertificateHtml(v)).toThrow(VoidedRecordError);
  });
});

describe('discardAssessment', () => {
  const make = () => createAssessment({ patientId: 'p1', instrumentId: ASSESSMENT_INSTRUMENTS[0].id, answers: {}, hospitalId: 'hosp-a1', orgId: 'org-a' });
  it('discards a held assessment softly and hides it everywhere', async () => {
    const a = await make();
    const d = await discardAssessment(a._id, 'wrong patient', { userId: 'u1', userName: 'Nurse' });
    expect(d).toMatchObject({ documentStatus: 'discarded', discardReason: 'wrong patient', discardedByName: 'Nurse' });
    expect(await getAssessmentsByPatient('p1', SCOPE)).toHaveLength(0);
    expect(await getHeldAssessments(SCOPE)).toHaveLength(0);
    await expect(updateAssessmentAnswers(a._id, {})).rejects.toBeInstanceOf(AssessmentLockError);
  });
  it('refuses a signed assessment', async () => {
    const a = await make();
    await signAssessment(a._id, { userId: 'u2', userName: 'Dr', userRole: 'doctor' });
    await expect(discardAssessment(a._id, 'x', { userName: 'Nurse' })).rejects.toBeInstanceOf(AssessmentLockError);
    expect(await getAssessmentsByPatient('p1', SCOPE)).toHaveLength(1);
  });
});
