/**
 * @jest-environment node
 *
 * One account-creation act, one story about credentials.
 *
 * `/api/users` attempts an invitation on EVERY account it creates and returns
 * what happened. Only `/org-admin/users` ever read that field. `/admin/users`
 * and the create-organization flow discarded it and unconditionally showed a
 * temporary password — and `/admin/users` had no email input at all, so a
 * super-admin-created account could never be invited in the first place.
 *
 * The operator's question is always the same: has this person already been
 * emailed a link, or do I have to read a password out to them? These pin that
 * every surface answers it, and answers it the same way.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describeInvitationOutcome } from '@/lib/invitation-copy';

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

const CREATION_SURFACES = [
  'app/(dashboard)/admin/users/page.tsx',
  // The org roster and a facility's Staff tab both create accounts through
  // this one dialog, so the surface to pin is the dialog — see
  // DELEGATING_SURFACES below for the pages that must keep using it rather
  // than growing a second form.
  'components/admin/CreateUserModal.tsx',
  'app/(dashboard)/admin/organizations/page.tsx',
];

/** Pages whose "create user" action must route through the shared dialog. */
const DELEGATING_SURFACES = [
  'app/(dashboard)/org-admin/users/page.tsx',
  'components/facilities/FacilityManageTabs.tsx',
];

describe('every creation surface reports the invitation', () => {
  test.each(CREATION_SURFACES)('%s asks for the outcome', file => {
    expect(source(file)).toContain('createUserWithInvitation');
  });

  test.each(DELEGATING_SURFACES)('%s creates through the shared dialog', file => {
    // A second copy of the form is how the outcome got dropped on two
    // surfaces in the first place.
    expect(source(file)).toContain('CreateUserModal');
    expect(source(file)).not.toContain('createUserWithInvitation');
  });

  test.each(CREATION_SURFACES)('%s carries it into the hand-off', file => {
    // Any form that passes the value on: `invitation={...}`, `invitation:`,
    // `invitation,`, `invitation)` or the object shorthand `invitation }`.
    expect(source(file)).toMatch(/invitation\s*[=:,)}]/);
  });

  test.each(CREATION_SURFACES)('%s collects an email address to send to', file => {
    // Without one the route can only answer `no_email`, so the invitation
    // machinery is dead weight and the temp password is the only route in.
    expect(source(file)).toMatch(/email/i);
  });

  test('the copy has one source, not one per page', () => {
    // /org-admin/users used to spell out its own ternary chain, which had no
    // branch for `no_email` at all — the commonest outcome on the surfaces
    // that could not collect an address. Since the 2026-08 console restyle it
    // renders the shared CredentialHandoffModal (like /admin/users), which is
    // where the one copy chain lives.
    expect(source('components/admin/CredentialHandoffModal.tsx')).toContain('describeInvitationOutcome');
    expect(source('app/(dashboard)/org-admin/users/page.tsx')).toContain('CredentialHandoffModal');
  });
});

describe('describeInvitationOutcome', () => {
  test('a delivered invitation says the password is only a fallback', () => {
    const copy = describeInvitationOutcome({ sent: true, to: 'a@b.c', expiresAt: 'x' });
    expect(copy.mustSharePassword).toBe(false);
    expect(copy.message).toContain('a@b.c');
    expect(copy.message).toMatch(/own password/i);
  });

  test.each(['no_email', 'not_configured', 'no_app_url', 'send_failed'] as const)(
    '%s tells the operator to hand the password over',
    reason => {
      const copy = describeInvitationOutcome({ sent: false, reason });
      expect(copy.mustSharePassword).toBe(true);
      expect(copy.message).toMatch(/share these credentials/i);
    },
  );

  test('every failure reason gets its own explanation, not a shrug', () => {
    const messages = (['no_email', 'not_configured', 'no_app_url', 'send_failed'] as const)
      .map(reason => describeInvitationOutcome({ sent: false, reason }).message);
    expect(new Set(messages).size).toBe(messages.length);
  });

  test('no outcome at all (a password reset) falls back to the plain sentence', () => {
    const copy = describeInvitationOutcome(undefined);
    expect(copy.mustSharePassword).toBe(true);
    expect(copy.message).toMatch(/^Share these credentials/);
  });
});
