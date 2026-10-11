/**
 * @jest-environment node
 *
 * `toOrgId` is a cross-org visibility grant that only referrals and patient
 * transfers legitimately carry. A patient (or any other document) carrying it
 * must not become visible to another organisation, and the patient PATCH
 * surface must refuse to write it.
 */
import { filterByScope } from '@/lib/services/data-scope';
import { stripProtectedPatientFields } from '@/lib/patient-redaction';

const receiver = { role: 'org_admin' as const, orgId: 'org-b' };

describe('filterByScope toOrgId branch', () => {
  test('referrals and transfers addressed to the org stay visible', () => {
    const docs = [
      { _id: 'r', type: 'referral', orgId: 'org-a', toOrgId: 'org-b' },
      { _id: 't', type: 'patient_transfer', orgId: 'org-a', toOrgId: 'org-b' },
    ];
    expect(filterByScope(docs, receiver).map(d => d._id)).toEqual(['r', 't']);
  });
  test('a patient (or anything else) carrying toOrgId is not exposed', () => {
    const docs = [
      { _id: 'p', type: 'patient', orgId: 'org-a', toOrgId: 'org-b' },
      { _id: 'm', type: 'medical_record', orgId: 'org-a', toOrgId: 'org-b' },
    ];
    expect(filterByScope(docs, receiver)).toEqual([]);
  });
});

describe('patient PATCH protected fields', () => {
  test('toOrgId and sibling routing fields are stripped on the route; toOrgId on the service too', () => {
    const patch = { phone: '1', toOrgId: 'org-b', toHospitalId: 'h', fromHospitalId: 'h', recipientHospitalId: 'h', facilityId: 'h' };
    expect(stripProtectedPatientFields(patch, { route: true })).toEqual({ phone: '1' });
    expect(stripProtectedPatientFields(patch)).not.toHaveProperty('toOrgId');
  });
});
