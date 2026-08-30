/**
 * Triage clinical-core hardening (KAN triage audit):
 *
 *  - The service's override-reason gate must RECOMPUTE the vitals-based
 *    recommendation from the doc's own vitals + the patient's age, never
 *    trust a caller-supplied `vitalUrgencyRecommendation` (item 6's service
 *    half — the API-route half is covered separately under `__tests__/api`).
 *  - `createTriage` refuses a second active (pending/seen) triage for the
 *    same patient, EXCEPT via `resumePendingId`, which updates the existing
 *    placeholder in place instead (item 9).
 *  - `updateTriage` threads an explicit actor into its audit rows instead of
 *    misusing `handoffTo`, and audits a pure content amendment (no status
 *    change) by field name (item 8).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-hard` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => {
  const actual = jest.requireActual('@/lib/services/audit-service');
  // triage-service.ts calls `logAuditSafe`, never `logAudit` directly — that
  // is the binding that must be mocked. (Mocking `logAudit` would not
  // intercept it: `logAuditSafe`'s own call to `logAudit` is a same-module
  // reference, not a re-lookup through this mocked `exports` object.)
  return { ...actual, logAuditSafe: jest.fn().mockResolvedValue(undefined) };
});

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { logAuditSafe } from '@/lib/services/audit-service';
import {
  createTriage, updateTriage, findActiveTriageForPatient, DuplicateActiveTriageError,
} from '@/lib/services/triage-service';
import type { PatientDoc } from '@/lib/db-types';

const mockLogAudit = logAuditSafe as jest.MockedFunction<typeof logAuditSafe>;

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
  jest.clearAllMocks();
});

function triageInput(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'patient-1',
    patientName: 'Test Patient',
    airway: 'clear',
    breathing: 'normal',
    circulation: 'normal',
    consciousness: 'alert',
    assessmentSource: 'clinician',
    priority: 'GREEN',
    triagedBy: 'nurse-1',
    triagedByName: 'Nurse Test',
    // Recent, not fixed: "active" now also means within the 24h queue window,
    // so a hardcoded date would silently age the whole fixture out of scope.
    triagedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    status: 'seen',
    ...overrides,
  } as unknown as Parameters<typeof createTriage>[0];
}

describe('service-side recompute, not trust (item 6)', () => {
  test('dangerous vitals + GREEN + a misleading client recommendation → still rejected without a reason', async () => {
    // SpO2 70 is IITT high-risk regardless of age; the caller here claims
    // (falsely) that the recommendation is GREEN and does not override.
    await expect(createTriage(triageInput({
      oxygenSaturation: '70',
      priority: 'GREEN',
      vitalUrgencyRecommendation: 'GREEN',
      vitalUrgencyWarnings: [],
    }))).rejects.toThrow('Saving below the recommended triage urgency');
  });

  test('the same dangerous vitals, saved with a recorded override reason, are accepted', async () => {
    const saved = await createTriage(triageInput({
      oxygenSaturation: '70',
      priority: 'GREEN',
      vitalUrgencyOverridden: true,
      vitalUrgencyOverrideReason: 'Repeat reading pending; patient stable on room air, monitored.',
    }));
    expect(saved.priority).toBe('GREEN');
    expect(saved.vitalUrgencyOverridden).toBe(true);
  });

  test('omitting vitalUrgencyRecommendation entirely does not bypass the gate either', async () => {
    await expect(createTriage(triageInput({ oxygenSaturation: '70', priority: 'GREEN' })))
      .rejects.toThrow('Saving below the recommended triage urgency');
  });
});

describe('duplicate-active-triage guard (item 9)', () => {
  test('findActiveTriageForPatient finds a pending or seen triage but not a terminal one', async () => {
    expect(await findActiveTriageForPatient('patient-2')).toBeUndefined();

    await createTriage(triageInput({ patientId: 'patient-2', status: 'discharged' }));
    expect(await findActiveTriageForPatient('patient-2')).toBeUndefined();

    // Move a fresh patient's triage to 'pending' and confirm it now resolves.
    await createTriage(triageInput({ patientId: 'patient-3', status: 'pending' }));
    const active = await findActiveTriageForPatient('patient-3');
    expect(active?.status).toBe('pending');
  });

  test('a second createTriage for the same active patient is refused with a coded error', async () => {
    await createTriage(triageInput({ patientId: 'patient-4', status: 'pending' }));
    await expect(createTriage(triageInput({ patientId: 'patient-4', status: 'seen' })))
      .rejects.toBeInstanceOf(DuplicateActiveTriageError);
  });

  test('a NEW createTriage for a patient whose only triage is terminal is allowed', async () => {
    await createTriage(triageInput({ patientId: 'patient-5', status: 'discharged' }));
    const second = await createTriage(triageInput({ patientId: 'patient-5', status: 'pending' }));
    expect(second.patientId).toBe('patient-5');
  });

  test('a stale pending triage outside the 24h window neither resolves as active nor blocks a new check-in', async () => {
    // The bug this pins: a week-old seeded/abandoned `pending` record made
    // createTriage refuse every future walk-in for that patient. The queue
    // already treats >24h non-terminal docs as unclosed visits, not waiting
    // patients — the duplicate guard must share that clock.
    await createTriage(triageInput({
      patientId: 'patient-7',
      status: 'pending',
      triagedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    expect(await findActiveTriageForPatient('patient-7')).toBeUndefined();
    const fresh = await createTriage(triageInput({ patientId: 'patient-7', status: 'pending' }));
    expect(fresh.patientId).toBe('patient-7');
  });

  test('resumePendingId updates the existing pending placeholder instead of being refused — the check-in-service contract', async () => {
    // The clerical placeholder check-in-service.ts writes for every walk-in.
    const placeholder = await createTriage(triageInput({
      patientId: 'patient-6',
      airway: 'not_assessed', breathing: 'not_assessed', circulation: 'not_assessed', consciousness: 'not_assessed',
      assessmentSource: 'clerical_checkin',
      status: 'pending',
    }));

    // The nurse's real ETAT assessment for the SAME visit must not be
    // refused just because the placeholder is still active.
    const completed = await createTriage(
      triageInput({ patientId: 'patient-6', status: 'seen' }),
      { resumePendingId: placeholder._id },
    );
    expect(completed._id).toBe(placeholder._id);
    expect(completed.status).toBe('seen');
    expect(completed.assessmentSource).toBe('clinician');

    // One triage record for the visit, not two.
    const all = await findActiveTriageForPatient('patient-6');
    expect(all?._id).toBe(placeholder._id);
  });
});

describe('updateTriage actor + amendment audit (item 8)', () => {
  test('a status change audits the passed-in actor, not handoffTo/handoffToName', async () => {
    const created = await createTriage(triageInput({ patientId: 'patient-7', status: 'pending' }));
    mockLogAudit.mockClear();

    await updateTriage(
      created._id,
      { status: 'seen', handoffTo: 'clinician-9', handoffToName: 'Dr Someone Else' },
      { userId: 'nurse-42', username: 'nurse.grace' },
    );

    const statusChangeCall = mockLogAudit.mock.calls.find(call => call[0] === 'TRIAGE_STATUS_CHANGE');
    expect(statusChangeCall).toBeDefined();
    expect(statusChangeCall![1]).toBe('nurse-42');
    expect(statusChangeCall![2]).toBe('nurse.grace');
  });

  test('a status change with no actor logs an honest undefined rather than a wrong handoffTo value', async () => {
    const created = await createTriage(triageInput({ patientId: 'patient-8', status: 'pending' }));
    mockLogAudit.mockClear();

    await updateTriage(created._id, { status: 'seen', handoffTo: 'clinician-9' });

    const statusChangeCall = mockLogAudit.mock.calls.find(call => call[0] === 'TRIAGE_STATUS_CHANGE');
    expect(statusChangeCall![1]).toBeUndefined();
  });

  test('a pure content amendment (no status change) audits which fields changed, by name only', async () => {
    const created = await createTriage(triageInput({ patientId: 'patient-9', status: 'seen' }));
    mockLogAudit.mockClear();

    await updateTriage(
      created._id,
      { chiefComplaint: 'Corrected: severe headache, not mild', temperature: '38.2' },
      { userId: 'nurse-42', username: 'nurse.grace' },
    );

    const amendedCall = mockLogAudit.mock.calls.find(call => call[0] === 'TRIAGE_AMENDED');
    expect(amendedCall).toBeDefined();
    expect(amendedCall![1]).toBe('nurse-42');
    const details = amendedCall![3] as string;
    expect(details).toContain('chiefComplaint');
    expect(details).toContain('temperature');
    // Never the PHI value itself in the audit detail.
    expect(details).not.toContain('severe headache');
    expect(details).not.toContain('38.2');
  });

  test('a no-op update (nothing actually changed) does not emit an amendment audit', async () => {
    const created = await createTriage(triageInput({ patientId: 'patient-10', status: 'seen', chiefComplaint: 'Fever' }));
    mockLogAudit.mockClear();

    await updateTriage(created._id, { chiefComplaint: 'Fever' }, { userId: 'nurse-42', username: 'nurse.grace' });

    expect(mockLogAudit.mock.calls.some(call => call[0] === 'TRIAGE_AMENDED')).toBe(false);
  });
});

// Sanity: the guard's patient lookup is best-effort — a patient the local
// database has never seen must not block or crash triage creation.
describe('age lookup resilience', () => {
  test('creating a triage for a patient with no local record still succeeds', async () => {
    const saved = await createTriage(triageInput({ patientId: 'patient-unknown-to-this-device' }));
    expect(saved.patientId).toBe('patient-unknown-to-this-device');
  });

  test('a real patient record is used when present (age-banded vitals still evaluated correctly)', async () => {
    await putDoc(patientsDB(), {
      _id: 'patient-with-dob',
      type: 'patient',
      firstName: 'Test',
      surname: 'Adult',
      dateOfBirth: '1990-01-01',
    } as unknown as PatientDoc & { _id: string });

    // Adult pulse 160 is RED (>150 per IITT); priority GREEN below that must
    // be refused without a recorded override — proof the patient's real age
    // (adult, from dateOfBirth) reached the recompute, not just a bare id.
    await expect(createTriage(triageInput({ patientId: 'patient-with-dob', pulse: '160' })))
      .rejects.toThrow('Saving below the recommended triage urgency');
  });
});
