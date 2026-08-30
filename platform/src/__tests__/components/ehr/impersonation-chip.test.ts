/**
 * @jest-environment node
 *
 * `impersonationChipInfo` — whether EhrTopRail's support-session chip should
 * render, and what it should say.
 *
 * `actualRole` is minted into the JWT the moment a platform super-admin signs
 * in AS another role (`resolveEffectiveIdentity`, modules/identity/core/
 * login-session.ts), round-tripped through `/api/auth/me`, and canonicalised
 * onto `AppUser` in context.tsx — and until this existed, nothing on screen
 * named it: a workspace impersonated by support looked byte-for-byte
 * identical to that role's own ordinary session.
 *
 * Pure function on purpose, the same reason `railCenterLabels` in this same
 * file is one: EhrTopRail carries a dozen hook dependencies (useHospitals,
 * usePatients, useOrganizations, useUsers, useNotifications, useAuth, ...),
 * so the "when does the chip show, and what does it say" rule is pinned here
 * rather than by rendering the component.
 */

import { impersonationChipInfo } from '@/components/ehr/ehr-navigation';

describe('impersonationChipInfo', () => {
  it('is null for an ordinary session with no actualRole at all', () => {
    expect(impersonationChipInfo({ role: 'nurse', roleLabel: 'Nurse' })).toBeNull();
  });

  it('is null when actualRole happens to equal the active role', () => {
    // Not a real shape the server ever produces (resolveEffectiveIdentity only
    // sets actualRole when a DIFFERENT role was requested), but the chip must
    // not claim "support session" for a session that isn't one.
    expect(impersonationChipInfo({
      role: 'doctor', actualRole: 'doctor', roleLabel: 'Doctor', actualRoleLabel: 'Doctor',
    })).toBeNull();
  });

  it('shows both role names when a super-admin is signed in as another role', () => {
    expect(impersonationChipInfo({
      role: 'doctor',
      actualRole: 'super_admin',
      roleLabel: 'Doctor',
      actualRoleLabel: 'Platform Administrator',
    })).toEqual({ activeRoleLabel: 'Doctor', actualRoleLabel: 'Platform Administrator' });
  });

  it('falls back to the raw role string when no display label was resolved', () => {
    // getRoleConfig(...).label is looked up by the caller and passed in; if
    // that lookup ever returns nothing, the chip should still say SOMETHING
    // identifiable rather than rendering blank text.
    expect(impersonationChipInfo({ role: 'doctor', actualRole: 'super_admin' }))
      .toEqual({ activeRoleLabel: 'doctor', actualRoleLabel: 'super_admin' });
  });
});
