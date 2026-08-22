/**
 * Redeeming an invitation, against the real service and an in-memory database.
 *
 * `redeemUserInvite` runs behind an UNAUTHENTICATED endpoint and writes a
 * password, so these pin the rules that stand between an emailed link and a
 * staff account: single use, expiring, inactive accounts unreachable, and the
 * hash never surfacing to a client.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB } from '@/lib/db';
import {
  createUser, issueUserInvite, redeemUserInvite, redactUserForClient, getUserById,
} from '@/modules/identity/services/user-service';
import { hashInviteToken, issueInvite } from '@/modules/identity/provisioning/user-invite';
import type { UserDoc } from '@/lib/db-types';

const GOOD_PASSWORD = 'Kq7mHn2pWx4Z';

async function seedUser(over: Partial<UserDoc> = {}) {
  const user = await createUser({
    username: 'achol.mayen',
    password: 'TempPass123!',
    name: 'Achol Mayen',
    role: 'nurse',
    hospitalId: 'hosp-001',
    hospitalName: 'Juba Teaching Hospital',
    orgId: 'org-moh-ss',
    email: 'achol@example.org',
  });
  if (Object.keys(over).length) {
    const db = usersDB();
    const doc = await db.get(user._id) as UserDoc;
    await db.put({ ...doc, ...over });
  }
  return user;
}

afterEach(async () => { await teardownTestDBs(); });

describe('issuing an invitation', () => {
  test('stores only the hash, and hands the raw token back once', async () => {
    const user = await seedUser();
    const invite = await issueUserInvite(user._id);
    expect(invite).not.toBeNull();

    const stored = await getUserById(user._id) as UserDoc;
    expect(stored.inviteTokenHash).toBe(hashInviteToken(invite!.token));
    expect(JSON.stringify(stored)).not.toContain(invite!.token);
  });

  test('re-issuing invalidates the previous invitation', async () => {
    // "Send it again" must not leave two live links to one account.
    const user = await seedUser();
    const first = await issueUserInvite(user._id);
    await issueUserInvite(user._id);

    await expect(redeemUserInvite(first!.token, GOOD_PASSWORD))
      .resolves.toMatchObject({ ok: false, reason: 'not_found' });
  });

  test('an unknown user cannot be invited', async () => {
    await expect(issueUserInvite('user-nobody')).resolves.toBeNull();
  });
});

describe('redeeming', () => {
  test('sets the password and clears the forced-change flag', async () => {
    // The whole point of choosing your own password is not being asked to
    // change it again at first login.
    const user = await seedUser();
    const invite = await issueUserInvite(user._id);

    const result = await redeemUserInvite(invite!.token, GOOD_PASSWORD);
    expect(result.ok).toBe(true);

    const stored = await getUserById(user._id) as UserDoc;
    expect(stored.mustChangePassword).toBe(false);
    expect(stored.passwordHash).not.toBe(user.passwordHash);
  });

  test('is single use — the token dies on redemption', async () => {
    const user = await seedUser();
    const invite = await issueUserInvite(user._id);

    await expect(redeemUserInvite(invite!.token, GOOD_PASSWORD)).resolves.toMatchObject({ ok: true });

    const stored = await getUserById(user._id) as UserDoc;
    expect(stored.inviteTokenHash).toBeUndefined();
    expect(stored.inviteExpiresAt).toBeUndefined();

    await expect(redeemUserInvite(invite!.token, 'AnotherPass99!'))
      .resolves.toMatchObject({ ok: false, reason: 'not_found' });
  });

  test('an expired invitation is refused', async () => {
    const user = await seedUser();
    const expired = issueInvite(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30));
    await putDoc(usersDB(), {
      ...(await getUserById(user._id) as UserDoc),
      inviteTokenHash: expired.tokenHash,
      inviteExpiresAt: expired.expiresAt,
    } as never);

    await expect(redeemUserInvite(expired.token, GOOD_PASSWORD))
      .resolves.toMatchObject({ ok: false, reason: 'expired' });
  });

  test('a deactivated account cannot be reached through an old invitation', async () => {
    // Disabling someone must actually lock them out, including via a link that
    // was already in their inbox.
    const user = await seedUser();
    const invite = await issueUserInvite(user._id);
    const db = usersDB();
    await db.put({ ...(await db.get(user._id) as UserDoc), isActive: false });

    await expect(redeemUserInvite(invite!.token, GOOD_PASSWORD))
      .resolves.toMatchObject({ ok: false, reason: 'not_found' });
  });

  test('an unknown token is refused without touching anything', async () => {
    await seedUser();
    await expect(redeemUserInvite('not-a-real-token', GOOD_PASSWORD))
      .resolves.toMatchObject({ ok: false, reason: 'not_found' });
  });

  test('a short password is refused before the token is even looked up', async () => {
    const user = await seedUser();
    const invite = await issueUserInvite(user._id);

    await expect(redeemUserInvite(invite!.token, 'short'))
      .resolves.toMatchObject({ ok: false, reason: 'weak_password' });

    // And the invitation survives, so the person can try again.
    const stored = await getUserById(user._id) as UserDoc;
    expect(stored.inviteTokenHash).toBeDefined();
  });
});

describe('what reaches the browser', () => {
  test('the invitation hash is redacted like a password hash', async () => {
    // It is a credential: anyone holding it can set this account's password.
    const user = await seedUser();
    await issueUserInvite(user._id);
    const stored = await getUserById(user._id) as UserDoc;

    const safe = redactUserForClient(stored) as Record<string, unknown>;
    expect(safe.inviteTokenHash).toBeUndefined();
    expect(safe.passwordHash).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain(stored.inviteTokenHash as string);
  });
});
