/**
 * `impersonationAllowedFromPolicy` — the offline mirror of the login role
 * picker's impersonation gate.
 *
 * `context.tsx`'s offline sign-in path mirrors every other `/api/auth/login`
 * rule (role-not-assigned, hospital mismatch) but never consulted
 * `superAdminPolicies.impersonationEnabled` — so a device that had never
 * synced the platform config, or simply never checked it, granted
 * impersonation offline regardless of what the switch on /admin/security
 * said. The ONLINE path (`resolveEffectiveIdentity` in
 * modules/identity/core/login-session.ts) fails CLOSED when the policy is
 * off, undefined, or unreadable; this predicate is the same rule, extracted
 * so it is testable without a PouchDB instance or a browser.
 */

import { impersonationAllowedFromPolicy } from '@/lib/context';

describe('impersonationAllowedFromPolicy', () => {
  it('allows only an explicit true', () => {
    expect(impersonationAllowedFromPolicy({ impersonationEnabled: true })).toBe(true);
  });

  it('refuses an explicit false — the ordinary "switch is off" case', () => {
    expect(impersonationAllowedFromPolicy({ impersonationEnabled: false })).toBe(false);
  });

  it('refuses when the field was never set', () => {
    expect(impersonationAllowedFromPolicy({})).toBe(false);
  });

  it('refuses when there is no policy document at all — the unreadable-config case', () => {
    // This is what a device that has never synced tamamhealth_platform_config
    // (or hit an error reading it) passes in: fail CLOSED, never open-by-default.
    expect(impersonationAllowedFromPolicy(null)).toBe(false);
    expect(impersonationAllowedFromPolicy(undefined)).toBe(false);
  });

  it('is not fooled by a truthy-but-not-true value', () => {
    // A strict `=== true` on purpose — "1", "true" (the string), or any other
    // truthy JSON artefact from a hand-edited config document must not be
    // read as the switch being on.
    expect(impersonationAllowedFromPolicy({ impersonationEnabled: 'true' as unknown as boolean })).toBe(false);
    expect(impersonationAllowedFromPolicy({ impersonationEnabled: 1 as unknown as boolean })).toBe(false);
  });
});
