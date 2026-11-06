/**
 * voidEncounter: a visit opened in error becomes a terminal `voided` visit,
 * only while nothing clinical or financial hangs off it.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-vuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({
  logAudit: jest.fn(async () => undefined),
  logAuditSafe: jest.fn(async () => undefined),
}));

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { appointmentsDB, billingDB, getDB } from '@/lib/db';
import {
  createEncounter, getEncounter, getAllEncounters, getEncountersByPatient,
  hasClosedEncounterForPatient, voidEncounter, EncounterVoidError,
} from '@/lib/services/encounter-service';
import { canTransition, isTerminal } from '@/lib/clinical-flow/encounter-journey';
import { appointmentStatusForEncounter } from '@/lib/clinical-flow/visit-state';
import { orgOnlyScope } from '@/lib/services/data-scope';
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import { VISIT_VOID_ROLES } from '@/lib/clinical-flow/visit-permissions';

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const desk = { id: 'user-desk', name: 'Amira', role: 'front_desk' as const };
const doctor = { id: 'user-dr', name: 'Dr. Wani', role: 'doctor' as const };

const open = (overrides: Record<string, unknown> = {}) => createEncounter({
  patientId: 'pat-1', patientName: 'Pat One', clinicianId: 'user-dr', clinicianName: 'Dr. Wani',
  hospitalId: 'hosp-1', orgId: 'org-1', status: 'with_clinician', snapshot: {}, labOrderIds: [],
  startedAt: new Date().toISOString(), ...overrides,
} as never);

describe('state machine', () => {
  test('voided is terminal and reachable only from the pre-close ladder', () => {
    expect(isTerminal('voided')).toBe(true);
    expect(canTransition('with_clinician', 'voided')).toBe(true);
    expect(canTransition('awaiting_triage', 'voided')).toBe(true);
    expect(canTransition('awaiting_labs', 'voided')).toBe(false);
    expect(canTransition('discharged', 'voided')).toBe(false);
    expect(canTransition('voided', 'with_clinician')).toBe(false);
  });
  test('a voided visit projects its booking as cancelled', () => {
    expect(appointmentStatusForEncounter('voided')).toBe('cancelled');
  });
  test('every role that may void can write the encounter at sync', () => {
    const writers = DOC_WRITE_ROLES.clinical_encounter as readonly string[];
    for (const role of VISIT_VOID_ROLES) expect(writers).toContain(role);
  });
});

describe('voidEncounter', () => {
  test('voids, stamps reason/who/when and hides the visit from the lists', async () => {
    const enc = await open();
    const { encounter } = await voidEncounter(enc._id, '  wrong patient  ', desk);
    expect(encounter.status).toBe('voided');
    expect(encounter).toMatchObject({ voidReason: 'wrong patient', voidedBy: 'user-desk', voidedByName: 'Amira' });
    expect(encounter.voidedAt).toBeTruthy();
    expect(encounter.statusHistory?.at(-1)).toMatchObject({ from: 'with_clinician', to: 'voided', reason: 'wrong patient' });
    expect((await getAllEncounters()).map(e => e._id)).not.toContain(enc._id);
    expect((await getAllEncounters(undefined, { includeVoided: true })).map(e => e._id)).toContain(enc._id);
    expect((await getEncountersByPatient('pat-1', orgOnlyScope('org-1'))).map(e => e._id)).toContain(enc._id);
    expect(await hasClosedEncounterForPatient('pat-1')).toBe(false);
  });

  test('refuses without a reason, for an unlisted role, and past the pre-close ladder', async () => {
    const enc = await open();
    await expect(voidEncounter(enc._id, '  ', desk)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(voidEncounter(enc._id, 'x', { id: 'u', role: 'pharmacist' })).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
    const labs = await open({ status: 'awaiting_labs' });
    await expect(voidEncounter(labs._id, 'x', doctor)).rejects.toMatchObject({ code: 'NOT_VOIDABLE_STATUS' });
    expect((await getEncounter(enc._id))?.status).toBe('with_clinician');
  });

  test.each([
    ['a triage record', { triageId: 'triage-1' }],
    ['a consultation record', { medicalRecordId: 'rec-1' }],
    ['lab orders', { labOrderIds: ['lab-1'] }],
  ])('refuses a visit with %s', async (_label, patch) => {
    const enc = await open(patch);
    await expect(voidEncounter(enc._id, 'x', doctor)).rejects.toBeInstanceOf(EncounterVoidError);
    expect((await getEncounter(enc._id))?.status).toBe('with_clinician');
  });

  test('refuses a visit with a signed note, but not one with only a draft', async () => {
    const enc = await open();
    const notes = getDB('tamamhealth_clinical_notes');
    await putDoc(notes, { _id: 'note-d', type: 'clinical_note', patientId: 'pat-1', encounterId: enc._id, status: 'draft' } as never);
    await expect(voidEncounter(enc._id, 'x', doctor)).resolves.toBeTruthy();
    const enc2 = await open();
    await putDoc(notes, { _id: 'note-s', type: 'clinical_note', patientId: 'pat-1', encounterId: enc2._id, status: 'signed' } as never);
    await expect(voidEncounter(enc2._id, 'x', doctor)).rejects.toMatchObject({ code: 'HAS_CLINICAL_CONTENT' });
  });

  test('refuses a visit with a live bill but ignores a cancelled one', async () => {
    const enc = await open();
    await putDoc(billingDB(), { _id: 'bill-1', type: 'billing', patientId: 'pat-1', encounterId: enc._id, status: 'pending' } as never);
    await expect(voidEncounter(enc._id, 'x', doctor)).rejects.toMatchObject({ code: 'HAS_CLINICAL_CONTENT' });
    const bill = await billingDB().get('bill-1');
    await billingDB().put({ ...bill, status: 'cancelled' } as never);
    await expect(voidEncounter(enc._id, 'x', doctor)).resolves.toBeTruthy();
  });

  test('front desk frees the linked booking as cancelled', async () => {
    await putDoc(appointmentsDB(), { _id: 'apt-1', type: 'appointment', patientId: 'pat-1', status: 'checked_in', orgId: 'org-1', facilityId: 'hosp-1' } as never);
    const enc = await open({ appointmentId: 'apt-1', status: 'awaiting_triage' });
    const { appointmentFreed } = await voidEncounter(enc._id, 'duplicate check-in', desk);
    expect(appointmentFreed).toBe(true);
    expect(await appointmentsDB().get('apt-1')).toMatchObject({ status: 'cancelled', cancelledBy: 'user-desk' });
  });

  test('a clinician voids the visit but leaves the booking for the desk with a repair record', async () => {
    await putDoc(appointmentsDB(), { _id: 'apt-2', type: 'appointment', patientId: 'pat-1', status: 'checked_in', orgId: 'org-1', facilityId: 'hosp-1' } as never);
    const enc = await open({ appointmentId: 'apt-2' });
    const { appointmentFreed } = await voidEncounter(enc._id, 'wrong patient', doctor);
    expect(appointmentFreed).toBe(false);
    expect((await appointmentsDB().get('apt-2') as { status: string }).status).toBe('checked_in');
    const repair = await getDB('tamamhealth_encounters').get(`repair-void-appointment-${enc._id}`) as { status: string };
    expect(repair.status).toBe('open');
  });
});
