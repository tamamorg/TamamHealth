/**
 * Tests for the encrypted, ephemeral draft cache in lib/draft-storage.ts.
 *
 * Covers:
 *   - roundtrip save → load returns the same value
 *   - past-TTL drafts return null and are removed from storage
 *   - tampered ciphertext fails closed (decrypt error → null)
 *   - missing sessionStorage key → null (the per-tab key was lost)
 *   - dropAllDrafts removes only namespaced keys, leaves others alone
 *   - two distinct logical keys don't cross-contaminate
 *   - the plaintext dev fallback path when crypto.subtle is unavailable
 *
 * jsdom provides window.localStorage / window.sessionStorage. The Web Crypto
 * subtle implementation comes from jest.setup.ts, which patches in Node's
 * webcrypto.
 *
 * NOTE (verified while writing this suite): `saveDraft`/`loadDraft` currently
 * have no call sites anywhere in the app — consultation autosave writes
 * straight to PouchDB instead. The module is still exercised directly here
 * because it is a live, exported security surface (crypto round-trip +
 * `dropAllDrafts()` is wired into the real logout flow), and an unused
 * integration point is exactly the kind of code that regresses silently
 * without a test.
 */

import {
  saveDraft,
  loadDraft,
  dropDraft,
  dropAllDrafts,
  __INTERNAL__,
} from '@/lib/draft-storage';

const { STORAGE_PREFIX, SESSION_KEY_NAME, storageKey } = __INTERNAL__;

describe('draft-storage (AES-GCM, sessionStorage-pinned key)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('roundtrip: save then load returns the same value', async () => {
    const value = {
      chiefComplaint: 'fever 3 days',
      vitals: { temperature: '38.7', systolic: '120' },
      diagnoses: [{ code: 'B54', name: 'Malaria', type: 'primary' }],
    };
    await saveDraft('consultation:patient-42', value);
    const restored = await loadDraft<typeof value>('consultation:patient-42');
    expect(restored).toEqual(value);
  });

  it('persists ciphertext, not plaintext, in localStorage', async () => {
    const secret = 'CONFIDENTIAL_PHI_chief_complaint_42';
    await saveDraft('consultation:secret-test', { complaint: secret });

    // Walk every localStorage value and assert the secret string isn't visible.
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!;
      const v = window.localStorage.getItem(k) ?? '';
      expect(v).not.toContain(secret);
    }
  });

  it('uses a fresh IV per write — two saves of the same value produce different ciphertext', async () => {
    const key = 'consultation:iv-test';
    await saveDraft(key, { complaint: 'same value both times' });
    const first = JSON.parse(window.localStorage.getItem(storageKey(key))!).ciphertext;
    await saveDraft(key, { complaint: 'same value both times' });
    const second = JSON.parse(window.localStorage.getItem(storageKey(key))!).ciphertext;
    expect(first).not.toBe(second);
  });

  it('returns null and removes the entry when the draft is past TTL', async () => {
    const key = 'consultation:expiry-test';
    await saveDraft(key, { foo: 'bar' }, 50 /* ms */);

    // Confirm it's there before expiry.
    expect(await loadDraft(key)).toEqual({ foo: 'bar' });

    // Wait past the TTL.
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(await loadDraft(key)).toBeNull();
    // And the storage entry is gone (lazy expiry).
    expect(window.localStorage.getItem(storageKey(key))).toBeNull();
  });

  it('returns null when the ciphertext is tampered with', async () => {
    const key = 'consultation:tamper-test';
    await saveDraft(key, { complaint: 'tampering victim' });

    const sk = storageKey(key);
    const raw = window.localStorage.getItem(sk);
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!) as { ciphertext: string };

    // Flip one base64 char near the middle of the ciphertext to corrupt the
    // auth-tag / data without breaking the envelope JSON.
    const ct = record.ciphertext;
    expect(ct.length).toBeGreaterThan(20);
    const mid = Math.floor(ct.length / 2);
    const replacement = ct[mid] === 'A' ? 'B' : 'A';
    record.ciphertext = ct.slice(0, mid) + replacement + ct.slice(mid + 1);
    window.localStorage.setItem(sk, JSON.stringify(record));

    expect(await loadDraft(key)).toBeNull();
  });

  it('returns null when the sessionStorage key is missing (lost the AES key)', async () => {
    const key = 'consultation:lost-key-test';
    await saveDraft(key, { complaint: 'will be unreadable' });

    // Simulate tab close / different tab — kill the per-tab key but leave
    // the encrypted draft in localStorage.
    window.sessionStorage.removeItem(SESSION_KEY_NAME);

    const restored = await loadDraft(key);
    expect(restored).toBeNull();
  });

  it('dropDraft removes a single key and leaves others alone', async () => {
    await saveDraft('consultation:p-A', { v: 1 });
    await saveDraft('consultation:p-B', { v: 2 });

    await dropDraft('consultation:p-A');

    expect(await loadDraft('consultation:p-A')).toBeNull();
    expect(await loadDraft('consultation:p-B')).toEqual({ v: 2 });
  });

  it('dropAllDrafts removes only namespaced keys, leaves other localStorage entries alone', async () => {
    await saveDraft('consultation:p-A', { v: 'A' });
    await saveDraft('consultation:p-B', { v: 'B' });

    // Unrelated app state under different keys — must survive.
    window.localStorage.setItem('tamamhealth-token', 'fake-jwt');
    window.localStorage.setItem('user-pref:theme', 'dark');

    await dropAllDrafts();

    // Every namespaced key gone.
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!;
      expect(k.startsWith(STORAGE_PREFIX)).toBe(false);
    }
    // Unrelated keys preserved.
    expect(window.localStorage.getItem('tamamhealth-token')).toBe('fake-jwt');
    expect(window.localStorage.getItem('user-pref:theme')).toBe('dark');
    // The per-tab AES key was also wiped — this is what makes logout safe on
    // a shared device even if a stray reference to it lingered.
    expect(window.sessionStorage.getItem(SESSION_KEY_NAME)).toBeNull();
  });

  it('two distinct logical keys do not cross-contaminate', async () => {
    await saveDraft('consultation:patient-A', { who: 'Alice' });
    await saveDraft('consultation:patient-B', { who: 'Bob' });

    expect(await loadDraft('consultation:patient-A')).toEqual({ who: 'Alice' });
    expect(await loadDraft('consultation:patient-B')).toEqual({ who: 'Bob' });

    await dropDraft('consultation:patient-A');
    expect(await loadDraft('consultation:patient-A')).toBeNull();
    // B is untouched.
    expect(await loadDraft('consultation:patient-B')).toEqual({ who: 'Bob' });
  });

  it('loadDraft returns null for a key that was never saved', async () => {
    expect(await loadDraft('consultation:nonexistent')).toBeNull();
  });

  it('reuses the same per-tab key across multiple saves (round-trips after a second save)', async () => {
    await saveDraft('consultation:reuse-A', { v: 1 });
    const keyAfterFirst = window.sessionStorage.getItem(SESSION_KEY_NAME);
    await saveDraft('consultation:reuse-B', { v: 2 });
    const keyAfterSecond = window.sessionStorage.getItem(SESSION_KEY_NAME);
    expect(keyAfterFirst).toBe(keyAfterSecond);
    // Both drafts remain readable under the one key.
    expect(await loadDraft('consultation:reuse-A')).toEqual({ v: 1 });
    expect(await loadDraft('consultation:reuse-B')).toEqual({ v: 2 });
  });
});

describe('draft-storage — fail closed when crypto.subtle is unavailable', () => {
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // Simulate an insecure context: no Web Crypto subtle API.
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
  });

  it('does not persist a draft without crypto.subtle', async () => {
    const value = { complaint: 'no https in dev' };
    await saveDraft('consultation:fallback-test', value);
    expect(await loadDraft('consultation:fallback-test')).toBeNull();
    expect(window.localStorage.getItem(storageKey('consultation:fallback-test'))).toBeNull();
  });

  it('deletes legacy plaintext fallback records instead of returning them', async () => {
    const key = storageKey('consultation:fallback-marker');
    window.localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      ttlMs: 60_000,
      ciphertext: 'plain:{"a":1}',
    }));
    expect(await loadDraft('consultation:fallback-marker')).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
