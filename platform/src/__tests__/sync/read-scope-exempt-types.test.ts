/** Which documents follow their facility on a read, and which do not. */
import { canReadFacilityDoc } from '@/lib/sync/read-scope';

const juba = { orgId: 'org-a', facilityIds: ['h-1'], allFacilities: false };
const wau = { orgId: 'org-a', hospitalId: 'h-2', facilityId: 'h-2' };

describe('facility read scope', () => {
  it.each(['conversation', 'message'])('leaves %s to its participant rule', type => {
    // A clinician who moved from Wau keeps threads stamped with Wau.
    expect(canReadFacilityDoc(juba, { ...wau, _id: 'c', type })).toBe(true);
  });

  it('keeps a task with its facility: it names a patient and a result', () => {
    expect(canReadFacilityDoc(juba, { ...wau, _id: 't', type: 'clinician_task' })).toBe(false);
    expect(canReadFacilityDoc(juba, { orgId: 'org-a', hospitalId: 'h-1', _id: 't', type: 'clinician_task' })).toBe(true);
  });

  it('still stops another organisation', () => {
    expect(canReadFacilityDoc(juba, { orgId: 'org-b', hospitalId: 'h-1', _id: 'c', type: 'conversation' })).toBe(false);
  });
});
