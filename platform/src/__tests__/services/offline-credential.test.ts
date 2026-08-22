/**
 * The device's offline sign-in credential.
 *
 * This is the only thing that lets a clinician into the app with the network
 * down: `tamamhealth_users` is deliberately not replicated, so the old offline
 * path resolved to "user not found" on every production device.
 */
import {
  cacheOfflineCredential,
  verifyOfflineCredential,
  clearOfflineCredential,
  hasOfflineCredential,
  OFFLINE_CREDENTIAL_TTL_DAYS,
  type OfflineCredentialClaims,
} from '@/modules/identity/core/offline-credential';

const claims: OfflineCredentialClaims = {
  _id: 'user-nurse.stella',
  username: 'nurse.stella',
  name: 'Nurse Stella Keji Lemi',
  role: 'nurse',
  hospitalId: 'hosp-003',
  hospitalName: 'Malakal Teaching Hospital',
  orgId: 'org-moh-ss',
};

beforeEach(() => {
  clearOfflineCredential();
});

describe('offline sign-in credential', () => {
  it('accepts the password the online sign-in was made with', async () => {
    await cacheOfflineCredential('correct horse battery', claims);
    await expect(verifyOfflineCredential('nurse.stella', 'correct horse battery'))
      .resolves.toEqual(claims);
  });

  it('rejects a wrong password', async () => {
    await cacheOfflineCredential('correct horse battery', claims);
    await expect(verifyOfflineCredential('nurse.stella', 'wrong')).resolves.toBeNull();
  });

  it('rejects a different user on the same device', async () => {
    await cacheOfflineCredential('correct horse battery', claims);
    await expect(verifyOfflineCredential('dr.wani', 'correct horse battery'))
      .resolves.toBeNull();
  });

  it('returns null when nothing has been cached', async () => {
    await expect(verifyOfflineCredential('nurse.stella', 'anything')).resolves.toBeNull();
  });

  it('holds only the most recent user, so a shared tablet keeps one', async () => {
    await cacheOfflineCredential('stella-pw', claims);
    await cacheOfflineCredential('wani-pw', { ...claims, _id: 'user-dr.wani', username: 'dr.wani' });

    await expect(verifyOfflineCredential('nurse.stella', 'stella-pw')).resolves.toBeNull();
    await expect(verifyOfflineCredential('dr.wani', 'wani-pw')).resolves.not.toBeNull();
  });

  it('never stores the password itself', async () => {
    await cacheOfflineCredential('correct horse battery', claims);
    const raw = window.localStorage.getItem('tamamhealth.offline-credential.v1') ?? '';
    expect(raw).not.toContain('correct horse battery');
    expect(raw).toMatch(/\$2[aby]\$/); // a bcrypt hash, not the plaintext
  });

  it('carries the facility claims a session needs, and no PHI', async () => {
    await cacheOfflineCredential('pw', claims);
    const restored = await verifyOfflineCredential('nurse.stella', 'pw');
    expect(restored?.hospitalId).toBe('hosp-003');
    expect(restored?.orgId).toBe('org-moh-ss');
    const raw = window.localStorage.getItem('tamamhealth.offline-credential.v1') ?? '';
    expect(raw).not.toMatch(/patient|diagnosis|prescription/i);
  });

  it('expires, so a device that leaves the clinic stops being a way in', async () => {
    await cacheOfflineCredential('pw', claims);
    const key = 'tamamhealth.offline-credential.v1';
    const stored = JSON.parse(window.localStorage.getItem(key)!);
    const staleDays = OFFLINE_CREDENTIAL_TTL_DAYS + 1;
    stored.cachedAt = new Date(Date.now() - staleDays * 86_400_000).toISOString();
    window.localStorage.setItem(key, JSON.stringify(stored));

    await expect(verifyOfflineCredential('nurse.stella', 'pw')).resolves.toBeNull();
    // …and the stale hash is not left behind once it can never be accepted.
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('is cleared on demand', async () => {
    await cacheOfflineCredential('pw', claims);
    expect(hasOfflineCredential('nurse.stella')).toBe(true);
    clearOfflineCredential();
    expect(hasOfflineCredential()).toBe(false);
    await expect(verifyOfflineCredential('nurse.stella', 'pw')).resolves.toBeNull();
  });
});
