/**
 * An organization administrator does not see their peers.
 *
 * Org admins hold the accounts that can create, disable and reset the password
 * of everyone else in the tenant. Listing them to each other means any one of
 * them can lock the others out, and it hands the full set of privileged
 * accounts to anyone who reaches a single org-admin session. The platform
 * super_admin is the only role that sees the whole set.
 *
 * Their own account stays visible — an admin who cannot find themselves in the
 * roster they are administering has been handed a different bug.
 */
import { filterByScope, buildScopeFromAuth, type DataScope } from '@/lib/services/data-scope';

const ORG = 'org-tamam';
const OTHER_ORG = 'org-mercy-hospital';

const users = [
  { _id: 'user-tamam', type: 'user', role: 'org_admin', orgId: ORG, name: 'Tamam' },
  { _id: 'user-tmakua01', type: 'user', role: 'org_admin', orgId: ORG, name: 'Teny' },
  { _id: 'user-drwani', type: 'user', role: 'doctor', orgId: ORG, hospitalId: 'hosp-001' },
  { _id: 'user-desk', type: 'user', role: 'front_desk', orgId: ORG, hospitalId: 'hosp-001' },
  { _id: 'user-super', type: 'user', role: 'super_admin' },
  { _id: 'user-mercy-admin', type: 'user', role: 'org_admin', orgId: OTHER_ORG },
];

const asOrgAdmin = (userId?: string): DataScope => ({ orgId: ORG, role: 'org_admin', userId });
const ids = (docs: { _id: string }[]) => docs.map(d => d._id);

describe('org admin peer visibility', () => {
  it('hides the other org admin in the same organization', () => {
    const seen = ids(filterByScope(users, asOrgAdmin('user-tamam')));
    expect(seen).not.toContain('user-tmakua01');
  });

  it('keeps the viewer their own account', () => {
    expect(ids(filterByScope(users, asOrgAdmin('user-tamam')))).toContain('user-tamam');
    // And symmetrically for the other admin, so this is a peer rule rather
    // than one account being privileged over another.
    expect(ids(filterByScope(users, asOrgAdmin('user-tmakua01')))).toContain('user-tmakua01');
    expect(ids(filterByScope(users, asOrgAdmin('user-tmakua01')))).not.toContain('user-tamam');
  });

  it('still shows every non-admin member of the organization', () => {
    const seen = ids(filterByScope(users, asOrgAdmin('user-tamam')));
    expect(seen).toEqual(expect.arrayContaining(['user-drwani', 'user-desk']));
  });

  it('never shows another organization, admin or otherwise', () => {
    const seen = ids(filterByScope(users, asOrgAdmin('user-tamam')));
    expect(seen).not.toContain('user-mercy-admin');
    // The platform super admin has no orgId and was already excluded by the
    // tenant filter; assert it so a future change to that filter is caught.
    expect(seen).not.toContain('user-super');
  });

  it('the super admin still sees every org admin', () => {
    const seen = ids(filterByScope(users, { role: 'super_admin' }));
    expect(seen).toEqual(expect.arrayContaining(['user-tamam', 'user-tmakua01', 'user-mercy-admin']));
  });

  it('hides all peers when the viewer id is unknown', () => {
    // Fails toward privacy: a scope built without `userId` must not fall back
    // to showing every privileged account.
    const seen = ids(filterByScope(users, asOrgAdmin(undefined)));
    expect(seen).not.toContain('user-tamam');
    expect(seen).not.toContain('user-tmakua01');
    expect(seen).toContain('user-drwani');
  });

  it('does not touch documents that merely mention a role', () => {
    // The rule keys on `type === 'user'`; a clinical record that happens to
    // carry a `role` field must pass through untouched.
    const docs = [{ _id: 'note-1', type: 'clinical_note', role: 'org_admin', orgId: ORG }];
    expect(ids(filterByScope(docs, asOrgAdmin('user-tamam')))).toEqual(['note-1']);
  });

  it('carries the viewer id from the JWT so API routes get the same answer', () => {
    // /api/users builds its scope this way; without `sub` the API would hide
    // an org admin from themselves while the UI showed them.
    const scope = buildScopeFromAuth({ role: 'org_admin', orgId: ORG, sub: 'user-tamam' });
    expect(scope.userId).toBe('user-tamam');
    expect(ids(filterByScope(users, scope))).toContain('user-tamam');
  });
});
