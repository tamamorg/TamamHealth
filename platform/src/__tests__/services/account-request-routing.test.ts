/**
 * Reviewer routing for account requests — the mechanism that decides whether
 * a request surfaces on the org admin's queue or the super admin's:
 * staff-role requests are reviewed by the applicant's org_admin, while
 * org_admin (new-organization) requests escalate to the super_admin.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import {
  createAccountRequest,
  getAccountRequests,
  updateAccountRequest,
} from '@/lib/services/account-request-service';

afterEach(async () => {
  await teardownTestDBs();
});

describe('account-request reviewer routing', () => {
  it('routes a staff request to the org admin', async () => {
    const request = await createAccountRequest({
      applicantName: 'Nyibol Arop',
      email: 'Nyibol.Arop@example.org',
      requestedRole: 'nurse',
      organizationId: 'org-juba',
      facilityId: 'hospital-juba-teaching',
    });
    expect(request.reviewerRole).toBe('org_admin');
    expect(request.status).toBe('pending');
    // Email is normalised so the pending-dedupe check can match reliably.
    expect(request.email).toBe('nyibol.arop@example.org');
  });

  it('escalates a new-organization (org_admin) request to the super admin', async () => {
    const request = await createAccountRequest({
      applicantName: 'Deng Mabior',
      email: 'deng@newclinic.example.org',
      requestedRole: 'org_admin',
      organizationName: 'New Clinic',
      organizationSlug: 'new-clinic',
    });
    expect(request.reviewerRole).toBe('super_admin');
    expect(request.organizationId).toBeUndefined();
  });

  it('returns the existing pending request instead of duplicating it', async () => {
    const first = await createAccountRequest({
      applicantName: 'Nyibol Arop',
      email: 'nyibol.arop@example.org',
      requestedRole: 'nurse',
      organizationId: 'org-juba',
      facilityId: 'hospital-juba-teaching',
    });
    const second = await createAccountRequest({
      applicantName: 'Nyibol Arop',
      email: 'NYIBOL.AROP@example.org',
      requestedRole: 'nurse',
      organizationId: 'org-juba',
      facilityId: 'hospital-juba-teaching',
    });
    expect(second._id).toBe(first._id);
    expect((await getAccountRequests()).length).toBe(1);
  });

  it('allows a new request once the earlier one is decided', async () => {
    const first = await createAccountRequest({
      applicantName: 'Nyibol Arop',
      email: 'nyibol.arop@example.org',
      requestedRole: 'nurse',
      organizationId: 'org-juba',
      facilityId: 'hospital-juba-teaching',
    });
    await updateAccountRequest(first._id, { status: 'rejected' });
    const second = await createAccountRequest({
      applicantName: 'Nyibol Arop',
      email: 'nyibol.arop@example.org',
      requestedRole: 'nurse',
      organizationId: 'org-juba',
      facilityId: 'hospital-juba-teaching',
    });
    expect(second._id).not.toBe(first._id);
  });
});
