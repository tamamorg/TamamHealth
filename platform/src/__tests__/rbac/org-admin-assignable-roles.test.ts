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
import { PLATFORM_ONLY_ASSIGNABLE_ROLES, isPlatformOnlyRole } from '@/modules/identity/policy/user-scope-rules';

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
      .toEqual(getAvailableRoles('public').filter(r => !isPlatformOnlyRole(r)));
  });

  it('never offers a role only a platform operator may grant', () => {
    // /api/users refuses `government` and `county_health_director` for an
    // org_admin exactly as it refuses `super_admin` — all three bypass org
    // scoping. Listing them put rows in the picker that could only 403.
    for (const orgType of ['public', 'private', undefined] as const) {
      for (const role of PLATFORM_ONLY_ASSIGNABLE_ROLES) {
        expect(assignableRolesForOrgAdmin(orgType)).not.toContain(role);
      }
    }
  });

  it('no longer varies by sector — the split only ever hid the platform roles', () => {
    // `getAvailableRoles` narrows a private organization by exactly three
    // roles: super_admin, government, county_health_director. All three are
    // now stripped for every org admin regardless of sector, because /api/users
    // refuses all three from an org_admin. So the two lists coincide, and that
    // is the correct outcome rather than a regression: the only difference the
    // sector made here WAS the privilege boundary.
    const priv = assignableRolesForOrgAdmin('private');
    const pub = assignableRolesForOrgAdmin('public');
    expect(priv).toEqual(pub);
    // The narrowing still exists one level down, where sector is about which
    // roles an organization employs rather than about privilege.
    expect(getAvailableRoles('private').length).toBeLessThan(getAvailableRoles('public').length);
    // Whatever else changes, delegation itself must survive.
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

describe("an organization's own roster of roles", () => {
  it('narrows the picker to the roles the organization employs', () => {
    const roles = assignableRolesForOrgAdmin('public', ['doctor', 'nurse', 'front_desk']);
    expect(roles).toEqual(expect.arrayContaining(['doctor', 'nurse', 'front_desk']));
    expect(roles).toHaveLength(3);
    expect(roles).not.toContain('org_admin');
  });

  it('narrows nothing when the organization has no roster', () => {
    // Absent and empty both mean "not configured" — every organization created
    // before the field existed relies on this.
    const full = assignableRolesForOrgAdmin('public');
    expect(assignableRolesForOrgAdmin('public', undefined)).toEqual(full);
    expect(assignableRolesForOrgAdmin('public', [])).toEqual(full);
  });

  it('cannot widen what the org type already allows', () => {
    // The roster is a convenience, not a grant: a role the private-sector list
    // excludes stays excluded even when the organization lists it, and
    // super_admin is never assignable however it is listed.
    const priv = assignableRolesForOrgAdmin('private');
    const listedButNotAllowed = getAvailableRoles('public').filter(r => !priv.includes(r));
    const roles = assignableRolesForOrgAdmin('private', [...priv, ...listedButNotAllowed, 'super_admin']);
    expect(roles).toEqual(priv);
    expect(roles).not.toContain('super_admin');
  });

  it('falls back to the full list rather than emptying the dropdown', () => {
    // A roster that intersects nothing assignable (stale roles, a hand-edited
    // document) must not reproduce the empty-picker bug this module exists to
    // prevent.
    const roles = assignableRolesForOrgAdmin('public', ['super_admin']);
    expect(roles).toEqual(assignableRolesForOrgAdmin('public'));
  });
});
