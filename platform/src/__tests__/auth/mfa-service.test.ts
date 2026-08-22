/**
 * @jest-environment node
 *
 * Second-factor enrolment against the user document.
 *
 * The behaviour that matters here is not "does TOTP work" — `totp.test.ts`
 * covers that — but the ORDER of operations. Enrolment is two steps on
 * purpose, and the gap between them is what keeps a mistyped secret from
 * locking somebody out of their own account.
 */

export {};

const store = new Map<string, Record<string, unknown>>();

function usersDB() {
  return {
    async get(id: string) {
      if (store.has(id)) return JSON.parse(JSON.stringify(store.get(id)));
      const err = new Error('missing') as Error & { status: number };
      err.status = 404;
      throw err;
    },
    async put(doc: Record<string, unknown>) {
      store.set(doc._id as string, JSON.parse(JSON.stringify(doc)));
      return { ok: true, id: doc._id, rev: '2-x' };
    },
  };
}

jest.mock('@/lib/db', () => ({ usersDB, auditLogDB: usersDB, platformConfigDB: usersDB }));
jest.mock('@/lib/services/audit-service', () => ({
  logAudit: jest.fn(async () => undefined),
  logAuditSafe: jest.fn(async () => undefined),
}));

const mockPolicy = { mfaRequired: true };
jest.mock('@/lib/services/platform-config-service', () => ({
  getPlatformConfig: async () => ({ superAdminPolicies: mockPolicy }),
}));

import {
  beginTotpEnrolment, confirmTotpEnrolment, disableTotp, verifySecondFactor,
  regenerateRecoveryCodes, isMfaRequiredFor, MFA_REQUIRED_ROLES,
} from '@/modules/identity/services/mfa-service';
import { totpCode, totpStep } from '@/modules/identity/mfa/totp';
import type { UserDoc } from '@/lib/db-types';

const ID = 'user-org.admin';

beforeEach(() => {
  store.clear();
  mockPolicy.mfaRequired = true;
  store.set(ID, {
    _id: ID, type: 'user', username: 'org.admin', name: 'Org Admin',
    passwordHash: 'x', role: 'org_admin', isActive: true,
  });
});

const stored = () => store.get(ID) as unknown as UserDoc;

describe('enrolment is two steps', () => {
  it('writes a secret that is NOT yet a live factor', () => {
    // A factor that went live the moment a secret existed would lock somebody
    // out for any mistake between the two steps — a mistyped key, an app that
    // failed to save, a browser closed halfway.
    return beginTotpEnrolment(ID).then(start => {
      expect(start.secret).toMatch(/^[A-Z2-7]+$/);
      expect(stored().totpSecret).toBe(start.secret);
      expect(stored().totpEnabledAt).toBeUndefined();
    });
  });

  it('goes live only once a working code proves the key went in', async () => {
    const { secret } = await beginTotpEnrolment(ID);
    const bad = await confirmTotpEnrolment(ID, '000000');
    expect(bad.ok).toBe(false);
    expect(stored().totpEnabledAt).toBeUndefined();

    const good = await confirmTotpEnrolment(ID, totpCode(secret));
    expect(good.ok).toBe(true);
    expect(stored().totpEnabledAt).toBeTruthy();
  });

  it('issues recovery codes exactly once, and stores only their hashes', async () => {
    const { secret } = await beginTotpEnrolment(ID);
    const result = await confirmTotpEnrolment(ID, totpCode(secret));
    if (!result.ok) throw new Error('enrolment failed');
    expect(result.recoveryCodes).toHaveLength(10);
    // Not one plaintext code is on the document.
    const raw = JSON.stringify(stored());
    for (const code of result.recoveryCodes) expect(raw).not.toContain(code);
    expect(stored().totpRecoveryCodeHashes).toHaveLength(10);
  });

  it('refuses to restart enrolment on an account that already has a factor', async () => {
    const { secret } = await beginTotpEnrolment(ID);
    await confirmTotpEnrolment(ID, totpCode(secret));
    // Silently replacing a live factor would let a borrowed session swap it
    // for one the attacker holds; removal goes through disableTotp, which
    // costs a password.
    await expect(beginTotpEnrolment(ID)).rejects.toThrow(/already enabled/);
  });

  it('lets an abandoned enrolment be started again', async () => {
    const first = await beginTotpEnrolment(ID);
    const second = await beginTotpEnrolment(ID);
    expect(second.secret).not.toBe(first.secret);
    expect(stored().totpSecret).toBe(second.secret);
  });
});

describe('verifying at sign-in', () => {
  let secret = '';
  beforeEach(async () => {
    secret = (await beginTotpEnrolment(ID)).secret;
    await confirmTotpEnrolment(ID, totpCode(secret));
  });

  it('accepts a fresh code and records the step it spent', async () => {
    // Enrolment already spends the current step, so verification has to be
    // tested a step later — which is exactly the replay guard working.
    const later = Date.now() + 30_000;
    const result = await verifySecondFactor(ID, totpCode(secret, later));
    expect(result.ok).toBe(true);
    expect(stored().totpLastUsedStep).toBe(totpStep(later));
  });

  it('refuses the same code twice', async () => {
    const later = Date.now() + 30_000;
    const code = totpCode(secret, later);
    expect((await verifySecondFactor(ID, code)).ok).toBe(true);
    expect((await verifySecondFactor(ID, code)).ok).toBe(false);
  });

  it('accepts a recovery code and strikes it off', async () => {
    const fresh = await regenerateRecoveryCodes(ID);
    if (!fresh) throw new Error('no codes');
    const result = await verifySecondFactor(ID, fresh[0]);
    expect(result).toMatchObject({ ok: true, usedRecoveryCode: true, recoveryCodesRemaining: 9 });
    expect((await verifySecondFactor(ID, fresh[0])).ok).toBe(false);
  });

  it('refuses everything for an account with no factor', async () => {
    await disableTotp(ID);
    expect((await verifySecondFactor(ID, totpCode(secret))).ok).toBe(false);
  });

  it('refuses for an account that does not exist', async () => {
    expect((await verifySecondFactor('user-nobody', '123456')).ok).toBe(false);
  });
});

describe('removing it', () => {
  it('erases every trace, so nothing half-enrolled is left behind', async () => {
    const { secret } = await beginTotpEnrolment(ID);
    await confirmTotpEnrolment(ID, totpCode(secret));
    await disableTotp(ID, 'org.admin');
    const doc = stored();
    expect(doc.totpSecret).toBeUndefined();
    expect(doc.totpEnabledAt).toBeUndefined();
    expect(doc.totpRecoveryCodeHashes).toBeUndefined();
    expect(doc.totpLastUsedStep).toBeUndefined();
  });
});

describe('who has to have one', () => {
  const asRole = (role: string, totpEnabledAt?: string) =>
    isMfaRequiredFor({ role, totpEnabledAt } as unknown as UserDoc);

  it('applies to the roles that can create accounts or run a facility', async () => {
    for (const role of MFA_REQUIRED_ROLES) expect(await asRole(role)).toBe(true);
  });

  it('does not apply to a ward nurse on a shared tablet', async () => {
    // Not a compromise: she is the last person a TOTP prompt should be tested
    // on first, and the blast radius is one facility's worklist.
    expect(await asRole('nurse')).toBe(false);
    expect(await asRole('front_desk')).toBe(false);
  });

  it('stops applying once the factor exists', async () => {
    expect(await asRole('org_admin', '2026-08-01T00:00:00.000Z')).toBe(false);
  });

  it('applies to nobody when the platform policy is off', async () => {
    mockPolicy.mfaRequired = false;
    expect(await asRole('super_admin')).toBe(false);
  });
});
