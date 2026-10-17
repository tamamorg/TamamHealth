/**
 * @jest-environment node
 *
 * Issuing a patient a way into the patient portal.
 *
 * The portal authenticated against `portalUsername` / `portalPasswordHash`
 * from the day it shipped and nothing ever wrote them: a working front door
 * with no way to issue a key, reachable by exactly one seeded demo patient.
 * These tests pin the half that was missing.
 */

export {};

const store = new Map<string, Record<string, unknown>>();

function patientsDB() {
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
    async find({ selector }: { selector: Record<string, unknown> }) {
      return { docs: [...store.values()].filter(d => d.type === selector.type) };
    },
    async createIndex() { return { result: 'created' }; },
  };
}

jest.mock('@/lib/db', () => ({ patientsDB, auditLogDB: patientsDB }));
jest.mock('@/lib/services/audit-service', () => ({
  logAudit: jest.fn(async () => undefined),
  logAuditSafe: jest.fn(async () => undefined),
}));

import {
  enrolPatientInPortal, activatePortalAccount, disablePortalAccount,
  summarisePortalAccess, suggestPortalUsername, recordPortalLogin, portalSignInBlocked,
  PORTAL_MIN_PASSWORD_LENGTH,
} from '@/modules/identity/services/patient-portal-enrolment';
import { verifyPassword } from '@/modules/identity/core/auth';
import type { PatientDoc } from '@/lib/db-types';

const ID = 'patient-1';

const seed = (id: string, over: Record<string, unknown> = {}) => {
  store.set(id, {
    _id: id, type: 'patient', firstName: 'Mary', surname: 'Lado',
    hospitalNumber: 'JTH-2026-0042', isActive: true, ...over,
  });
};

beforeEach(() => { store.clear(); seed(ID); });

const stored = (id = ID) => store.get(id) as unknown as PatientDoc;

describe('suggesting a username', () => {
  it('uses the name and the tail of the hospital number', () => {
    expect(suggestPortalUsername({ firstName: 'Mary', surname: 'Lado', hospitalNumber: 'JTH-2026-0042' }))
      .toBe('mary.lado.0042');
  });

  it('never produces an empty username', () => {
    expect(suggestPortalUsername({})).toBe('patient');
  });
});

describe('enrolling', () => {
  it('issues a code and stores only its hash', async () => {
    const result = await enrolPatientInPortal(ID, 'mary.lado', 'desk.amira');
    if (!result.ok) throw new Error(result.reason);
    expect(result.enrolment.username).toBe('mary.lado');
    expect(stored().portalUsername).toBe('mary.lado');
    // A database dump must not be replayable into somebody's medical record.
    expect(JSON.stringify(stored())).not.toContain(result.enrolment.activationCode);
    expect(stored().portalInviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not set a password — the patient chooses that', async () => {
    await enrolPatientInPortal(ID, 'mary.lado');
    expect(stored().portalPasswordHash).toBeUndefined();
    expect(summarisePortalAccess(stored())).toMatchObject({ enrolled: true, activated: false });
  });

  it('refuses a username another patient already uses', async () => {
    seed('patient-2', { portalUsername: 'mary.lado' });
    const result = await enrolPatientInPortal(ID, 'Mary.Lado');
    expect(result).toMatchObject({ ok: false, reason: 'username_taken' });
  });

  it('refuses a username too short to be one', async () => {
    expect(await enrolPatientInPortal(ID, 'a')).toMatchObject({ ok: false, reason: 'invalid_username' });
  });

  it('refuses a patient who does not exist', async () => {
    expect(await enrolPatientInPortal('patient-nobody', 'someone'))
      .toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('re-issuing does not revoke a working password', async () => {
    // A patient who lost the slip must not be locked out of their own record
    // by asking for a new one.
    await enrolPatientInPortal(ID, 'mary.lado');
    const first = await enrolPatientInPortal(ID, 'mary.lado');
    if (!first.ok) throw new Error('enrol failed');
    await activatePortalAccount(first.enrolment.activationCode, 'a-good-password');
    const hashBefore = stored().portalPasswordHash;

    await enrolPatientInPortal(ID, 'mary.lado');
    expect(stored().portalPasswordHash).toBe(hashBefore);
  });
});

describe('activating', () => {
  const enrol = async () => {
    const result = await enrolPatientInPortal(ID, 'mary.lado');
    if (!result.ok) throw new Error('enrol failed');
    return result.enrolment.activationCode;
  };

  it('sets the password the patient chose and burns the code', async () => {
    const code = await enrol();
    expect(await activatePortalAccount(code, 'a-good-password')).toMatchObject({ ok: true });
    expect(await verifyPassword('a-good-password', stored().portalPasswordHash!)).toBe(true);
    expect(stored().portalInviteTokenHash).toBeUndefined();
    // Single-use: the same slip cannot be redeemed twice.
    expect(await activatePortalAccount(code, 'another-password')).toMatchObject({ ok: false });
  });

  it('refuses a password below the floor', async () => {
    const code = await enrol();
    expect(await activatePortalAccount(code, 'x'.repeat(PORTAL_MIN_PASSWORD_LENGTH - 1)))
      .toMatchObject({ ok: false, reason: 'weak_password' });
  });

  it('refuses a code that was never issued', async () => {
    await enrol();
    expect(await activatePortalAccount('not-a-real-code', 'a-good-password'))
      .toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('refuses a code for a suspended account', async () => {
    const code = await enrol();
    await disablePortalAccount(ID, 'desk.amira');
    expect(await activatePortalAccount(code, 'a-good-password')).toMatchObject({ ok: false });
  });
});

describe('suspending', () => {
  it('keeps the credential but blocks sign-in, and kills any outstanding code', async () => {
    const result = await enrolPatientInPortal(ID, 'mary.lado');
    if (!result.ok) throw new Error('enrol failed');
    await activatePortalAccount(result.enrolment.activationCode, 'a-good-password');

    await disablePortalAccount(ID, 'desk.amira');
    // The password survives — suspension is usually reversible, and making a
    // patient re-enrol from scratch is a poor answer to a temporary problem.
    expect(stored().portalPasswordHash).toBeTruthy();
    expect(portalSignInBlocked(stored())).toBe(true);
    expect(stored().portalInviteTokenHash).toBeUndefined();
  });

  it('is lifted by enrolling again', async () => {
    await enrolPatientInPortal(ID, 'mary.lado');
    await disablePortalAccount(ID);
    await enrolPatientInPortal(ID, 'mary.lado');
    expect(portalSignInBlocked(stored())).toBe(false);
  });
});

describe('recording use', () => {
  it('stamps a sign-in, and does not rewrite the document twice a minute', async () => {
    await recordPortalLogin(ID, '2026-08-22T09:00:00.000Z');
    expect(stored().portalLastLoginAt).toBe('2026-08-22T09:00:00.000Z');
    await recordPortalLogin(ID, '2026-08-22T09:00:45.000Z');
    expect(stored().portalLastLoginAt).toBe('2026-08-22T09:00:00.000Z');
    await recordPortalLogin(ID, '2026-08-22T09:02:00.000Z');
    expect(stored().portalLastLoginAt).toBe('2026-08-22T09:02:00.000Z');
  });

  it('never throws for a patient that has gone', async () => {
    await expect(recordPortalLogin('patient-nobody')).resolves.toBeUndefined();
  });
});

describe('credential epoch', () => {
  it('stamps the epoch on suspend, enrol and activate', async () => {
    const e = await enrolPatientInPortal(ID, 'mary.lado');
    expect(e.ok).toBe(true);
    expect(stored().portalCredentialEpoch).toBeTruthy();
    if (!e.ok) return;
    store.set(ID, { ...store.get(ID)!, portalCredentialEpoch: undefined });
    await activatePortalAccount(e.enrolment.activationCode, 'a-long-enough-password');
    expect(stored().portalCredentialEpoch).toBeTruthy();
    store.set(ID, { ...store.get(ID)!, portalCredentialEpoch: undefined });
    await disablePortalAccount(ID);
    expect(stored().portalCredentialEpoch).toBeTruthy();
  });

  it('a token issued before suspend is rejected after re-enable', async () => {
    const { rejectIfPortalSessionRevoked } = await import('@/lib/patient-portal-auth');
    const iat = Math.floor(Date.now() / 1000) - 120;
    // Healthy, activated account with no epoch yet: the old token is fine.
    seed(ID, { portalUsername: 'mary.lado', portalPasswordHash: 'x' });
    expect(await rejectIfPortalSessionRevoked({ sub: ID, iat })).toBeNull();
    await disablePortalAccount(ID);
    expect(await rejectIfPortalSessionRevoked({ sub: ID, iat })).not.toBeNull();
    const re = await enrolPatientInPortal(ID, 'mary.lado');
    expect(re.ok).toBe(true);
    expect(stored().portalDisabledAt).toBeUndefined();
    expect(await rejectIfPortalSessionRevoked({ sub: ID, iat })).not.toBeNull();
    // A token minted after the re-enable is accepted.
    expect(await rejectIfPortalSessionRevoked({ sub: ID, iat: Math.floor(Date.now() / 1000) + 2 })).toBeNull();
  });
});
