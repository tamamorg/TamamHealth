/**
 * The roles an organization administrator can hand out.
 *
 * The bug this pins: /org-admin/users computed its role list only when
 * `currentUser.organization` was loaded. On a production org whose record had
 * not reached the browser's replica, the list stayed at its initial `[]` — the
 * Role dropdown rendered with no options, so an org admin could not create a
 * single user, and nothing on screen explained why. `orgType` only chooses
 * between the full list and the private-sector subset, so not knowing it must
 * narrow nothing.
 */
import {
  assignableRolesForOrgAdmin,
  getAvailableRoles,
} from '@/lib/permissions';

describe('roles an org admin may assign', () => {
  it('returns a usable list when the organization record has not loaded', () => {
    // The regression: this is the exact call the page makes when
    // `currentUser.organization` is undefined.
    const roles = assignableRolesForOrgAdmin(undefined);
    expect(roles.length).toBeGreaterThan(0);
    // The role the admin most needs to delegate must be among them.
    expect(roles).toContain('org_admin');
    expect(roles).toContain('doctor');
  });

  it('never lets an org admin mint a platform-wide account', () => {
    for (const orgType of [undefined, 'public', 'private'] as const) {
      expect(assignableRolesForOrgAdmin(orgType)).not.toContain('super_admin');
    }
  });

  it('treats an unknown org type as public, matching getAvailableRoles', () => {
    // Not knowing the org type is not a reason to offer fewer roles — only an
    // explicitly private organization gets the narrower set.
    expect(assignableRolesForOrgAdmin(undefined))
      .toEqual(getAvailableRoles('public').filter(r => r !== 'super_admin'));
  });

  it('still narrows a private-sector organization', () => {
    const priv = assignableRolesForOrgAdmin('private');
    const pub = assignableRolesForOrgAdmin('public');
    expect(priv).not.toEqual(pub);
    expect(priv.length).toBeLessThan(pub.length);
    // Whatever else changes, delegation itself must survive the narrowing.
    expect(priv).toContain('org_admin');
  });

  it('offers every facility-scoped role the create form asks a hospital for', () => {
    // The form requires a hospital for anything outside this set, so these
    // three are the only roles it can create before a facility exists.
    const withoutHospital = ['super_admin', 'org_admin', 'government'];
    const roles = assignableRolesForOrgAdmin(undefined);
    expect(roles.filter(r => !withoutHospital.includes(r)).length).toBeGreaterThan(0);
  });
});
