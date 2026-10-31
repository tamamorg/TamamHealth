/**
 * The lab's own intake writes through the real validator: a screen the server
 * refuses would save on the technician's device and reach nobody else.
 * Each grant is as narrow as the workflow: create, never rewrite.
 */
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';

type UserCtx = { name?: string; roles: string[] };
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as (
  newDoc: Record<string, unknown>, oldDoc: Record<string, unknown> | null, userCtx: UserCtx, secObj?: unknown,
) => void;
const refusal = (doc: Record<string, unknown>, old: Record<string, unknown> | null) => {
  try {
    validate(doc, old, { name: 'lab-1', roles: ['org:org-a', 'role:lab_tech', 'user:user-lab', 'facility:h-1'] }, {});
    return null;
  } catch (error) {
    return (error as { forbidden?: string }).forbidden ?? 'thrown';
  }
};
const base = { orgId: 'org-a', hospitalId: 'h-1', facilityId: 'h-1', createdAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T10:00:00Z' };
const patient = { ...base, _id: 'pat-1', type: 'patient', firstName: 'A', surname: 'B', registrationHospital: 'h-1' };
const encounter = { ...base, _id: 'enc-1', type: 'clinical_encounter', patientId: 'pat-1', status: 'awaiting_labs', stageKey: 'labs', labOrderIds: [], statusHistory: [], snapshot: {} };
const bill = { ...base, _id: 'bill-1', type: 'billing', patientId: 'pat-1', totalAmount: 1500, status: 'pending' };
const ledger = { ...base, _id: 'led-1', type: 'ledger_entry', patientId: 'pat-1', entryType: 'charge', amount: 1500 };

describe('lab technician intake', () => {
  it.each([['patient', patient], ['encounter', encounter], ['bill', bill], ['ledger entry', ledger]])('may create a %s', (_label, doc) => {
    expect(refusal(doc, null)).toBeNull();
  });

  it('files a request with its outside source and booked-in specimen', () => {
    const lab = {
      ...base, _id: 'lab-1', type: 'lab_result', patientId: 'pat-1', testName: 'Malaria RDT', status: 'pending', orderStatus: 'specimen_collected',
      requestSource: 'external_facility', externalFacility: 'Wau State Hospital', specimenCollectedOutside: true,
    };
    expect(refusal(lab, null)).toBeNull();
    expect(refusal({ ...lab, reportReleasedAt: '2026-10-30T12:00:00Z', reportReleasedBy: 'Lab' }, { ...lab, _rev: '1-a' })).toBeNull();
  });

  it('may park the visit at the lab and note its tests', () => {
    const old = { ...encounter, _rev: '1-a', status: 'in_consultation' };
    expect(refusal({ ...old, status: 'awaiting_labs', labOrderIds: ['lab-1'], updatedAt: '2026-10-30T11:00:00Z' }, old)).toBeNull();
  });

  it('may not rewrite a visit, a patient or a bill', () => {
    const oldVisit = { ...encounter, _rev: '1-a' };
    expect(refusal({ ...oldVisit, clinicianName: 'Someone else' }, oldVisit)).not.toBeNull();
    expect(refusal({ ...patient, _rev: '2-b', firstName: 'Changed' }, { ...patient, _rev: '1-a' })).not.toBeNull();
    expect(refusal({ ...bill, _rev: '2-b', totalAmount: 1 }, { ...bill, _rev: '1-a' })).not.toBeNull();
  });
});
