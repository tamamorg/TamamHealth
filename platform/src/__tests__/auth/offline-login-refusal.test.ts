/**
 * @jest-environment jsdom
 *
 * An offline sign-in that fails has to say the network is why.
 *
 * The offline path in `context.tsx` has three ways to refuse, and the sign-in
 * form rendered all of them as "Invalid credentials. Please try again.":
 * `login()` only recorded a `LoginFailure` when an HTTP *response* came back,
 * and a network error is swallowed by a bare `catch`. So a clinician on a new
 * device, or one whose browser had been cleared, or whose cached credential had
 * simply aged past OFFLINE_CREDENTIAL_TTL_DAYS, was told to retype a password
 * that was already correct — with nothing on screen saying that reaching the
 * network once was the actual requirement.
 *
 * These tests pin the distinction the form needs: a device that has never
 * cached this user (reconnect) versus one that has (the password really is
 * wrong, or was changed on another device).
 */
import {
  cacheOfflineCredential,
  verifyOfflineCredential,
  hasOfflineCredential,
  clearOfflineCredential,
  OFFLINE_CREDENTIAL_TTL_DAYS,
} from '@/modules/identity/core/offline-credential';
import en from '@/lib/i18n/locales/en';
import apd from '@/lib/i18n/locales/apd';

const CLAIMS = {
  _id: 'user-dr.wani',
  username: 'dr.wani',
  name: 'Dr. James Wani Igga',
  role: 'doctor' as const,
  hospitalId: 'hosp-001',
  orgId: 'org-moh-ss',
};

/**
 * The decision `context.tsx` makes once `verifyOfflineCredential` returns null
 * and the server was never reached. Mirrored here rather than imported because
 * the provider it lives in needs React, PouchDB and a network stack to load.
 */
const refusalCode = (username: string) =>
  hasOfflineCredential(username) ? 'offline_bad_password' : 'offline_no_credential';

beforeEach(() => {
  window.localStorage.clear();
  clearOfflineCredential();
});

describe('a device with no cached credential', () => {
  it('asks the user to reconnect rather than blaming the password', async () => {
    expect(await verifyOfflineCredential('dr.wani', 'Correct!1')).toBeNull();
    expect(refusalCode('dr.wani')).toBe('offline_no_credential');
  });

  it('says the same when the cache belongs to a different clinician', async () => {
    await cacheOfflineCredential('Correct!1', CLAIMS);
    // A shared tablet holds one user; the next person is a reconnect case.
    expect(await verifyOfflineCredential('nurse.mary', 'Correct!1')).toBeNull();
    expect(refusalCode('nurse.mary')).toBe('offline_no_credential');
  });
});

describe('a device that has cached this clinician', () => {
  it('reports a genuinely wrong password as a wrong password', async () => {
    await cacheOfflineCredential('Correct!1', CLAIMS);
    expect(await verifyOfflineCredential('dr.wani', 'WrongPass!9')).toBeNull();
    expect(refusalCode('dr.wani')).toBe('offline_bad_password');
  });

  it('still signs the right password in', async () => {
    await cacheOfflineCredential('Correct!1', CLAIMS);
    await expect(verifyOfflineCredential('dr.wani', 'Correct!1')).resolves.toMatchObject({
      _id: 'user-dr.wani', role: 'doctor',
    });
  });
});

describe('a credential older than the TTL', () => {
  it('becomes a reconnect case, not a wrong-password one', async () => {
    await cacheOfflineCredential('Correct!1', CLAIMS);
    // Age the record past its window, the way a tablet left in a drawer does.
    const key = 'tamamhealth.offline-credential.v1';
    const stored = JSON.parse(window.localStorage.getItem(key)!);
    stored.cachedAt = new Date(Date.now() - (OFFLINE_CREDENTIAL_TTL_DAYS + 1) * 86_400_000).toISOString();
    window.localStorage.setItem(key, JSON.stringify(stored));

    expect(await verifyOfflineCredential('dr.wani', 'Correct!1')).toBeNull();
    // verifyOfflineCredential clears an expired record, so the follow-up
    // question correctly reports "nothing cached" — which is the state the
    // device is now in, and reconnecting is what resolves it.
    expect(refusalCode('dr.wani')).toBe('offline_no_credential');
  });
});

describe('both offline refusals are sayable in both locales', () => {
  const KEYS = {
    offline_no_credential: 'login.errorOfflineNoCredential',
    offline_bad_password: 'login.errorOfflineBadPassword',
  } as const;

  it.each(Object.entries(KEYS))('%s renders in en and apd', (_code, key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((apd as Record<string, string>)[key]).toBeTruthy();
  });

  it('neither message tells the user their password is wrong when it is not', () => {
    expect(en['login.errorOfflineNoCredential']).toMatch(/network/i);
    expect(en['login.errorOfflineNoCredential']).not.toMatch(/invalid/i);
  });
});
