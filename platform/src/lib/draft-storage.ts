/**
 * Encrypted, ephemeral draft cache for in-progress PHI forms.
 *
 * Threat model
 * ------------
 * Shared clinical workstations (a tablet, a desktop in the consult room) are
 * routinely walked away from mid-form. The next user opens DevTools →
 * Application → Local Storage and reads everything in plaintext. Pre-existing
 * autosave logic on the consultation page persisted the chief complaint,
 * vitals, exam, diagnoses, prescriptions, and lab orders that way.
 *
 * Defence
 * -------
 * - A 256-bit AES-GCM key is generated lazily (Web Crypto, `generateKey`),
 *   exported as raw bytes, base64url-encoded, and parked under a fixed
 *   `sessionStorage` key. `sessionStorage` is per-tab and dies when the tab
 *   closes — the next user can't read drafts from a previous session because
 *   the key is gone, and the ciphertext in `localStorage` is then meaningless.
 * - Each write uses a fresh 12-byte IV. The Web Crypto AES-GCM cipher already
 *   appends the auth tag to the ciphertext, so we just store `IV | cipher`.
 * - Drafts have a TTL stamped at write-time; expired drafts are removed
 *   lazily on read.
 * - Logout calls `dropAllDrafts()` — best-effort, doesn't block logout.
 * - If `crypto.subtle` is unavailable, persistence fails closed. The caller's
 *   in-memory form state keeps working, but PHI is never written in plaintext.
 *
 * Storage shape
 * -------------
 *   sessionStorage:
 *     'tamamhealth.draft.k' -> base64url(raw 32-byte AES-GCM key)
 *
 *   localStorage (per draft):
 *     'tamamhealth.draft.<sanitizedKey>' -> JSON {
 *        savedAt:    epoch-ms,
 *        ttlMs:      number,
 *        ciphertext: base64(iv || ciphertext+tag)
 *     }
 */

const STORAGE_PREFIX = 'tamamhealth.draft.';
const SESSION_KEY_NAME = 'tamamhealth.draft.k';
const LEGACY_PLAINTEXT_PREFIX = 'plain:';
const DEFAULT_TTL_HOURS = Number(process.env.NEXT_PUBLIC_DRAFT_TTL_HOURS) || 24;
const DEFAULT_TTL_MS = DEFAULT_TTL_HOURS * 60 * 60 * 1000;

interface PersistedDraft {
  savedAt: number;
  ttlMs: number;
  ciphertext: string;
}

// ── Encoding helpers ────────────────────────────────────────────────────────

function base64UrlFromBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // btoa is universally available in browsers and modern Node; jsdom provides it.
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function base64FromBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function bytesFromBase64(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Sanitize the public key into a localStorage-safe suffix. We allow a-zA-Z0-9
// and `:_-.`, replace everything else with `_`. The crypto layer is what
// guarantees confidentiality; this is just so the storage key itself doesn't
// break on weird input.
function sanitizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9:_.-]/g, '_');
}

function storageKey(key: string): string {
  return STORAGE_PREFIX + sanitizeKey(key);
}

// ── Environment probes ──────────────────────────────────────────────────────

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function hasSubtleCrypto(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.encrypt === 'function'
  );
}

let warnedAboutUnavailableCrypto = false;
function warnUnavailableCryptoOnce(): void {
  if (warnedAboutUnavailableCrypto) return;
  warnedAboutUnavailableCrypto = true;
  console.warn(
    '[draft-storage] crypto.subtle unavailable (insecure context?). ' +
      'Draft persistence is disabled so PHI is not written in plaintext. ' +
      'Serve the application in a secure context to restore encrypted autosave.',
  );
}

// ── Per-tab AES-GCM key management ──────────────────────────────────────────

async function getOrCreateKey(): Promise<CryptoKey | null> {
  if (!hasWindow() || !hasSubtleCrypto()) return null;

  const ss = window.sessionStorage;
  const existing = ss.getItem(SESSION_KEY_NAME);

  if (existing) {
    try {
      const raw = bytesFromBase64Url(existing);
      // Pass the Uint8Array view directly — it's a valid BufferSource.
      // (Slicing raw.buffer creates an ArrayBuffer in the jsdom realm under
      // jest, which Node's webcrypto rejects with a cross-realm brand check.)
      return await crypto.subtle.importKey(
        'raw',
        raw as unknown as ArrayBuffer,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch {
      // Existing key was corrupt — drop and regenerate.
      ss.removeItem(SESSION_KEY_NAME);
    }
  }

  const fresh = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const exported = new Uint8Array(await crypto.subtle.exportKey('raw', fresh));
  ss.setItem(SESSION_KEY_NAME, base64UrlFromBytes(exported));
  return fresh;
}

// ── Crypto primitives ───────────────────────────────────────────────────────

async function encryptJson(value: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return base64FromBytes(combined);
}

async function decryptJson<T>(blob: string, key: CryptoKey): Promise<T> {
  const combined = bytesFromBase64(blob);
  if (combined.length < 13) throw new Error('ciphertext too short');
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct),
  );
  const text = new TextDecoder().decode(plaintext);
  return JSON.parse(text) as T;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Save a JSON-serializable draft. Encrypted with a per-tab AES-GCM key that
 * lives only in `sessionStorage` and is destroyed when the tab closes.
 *
 * @param key   Logical draft key (e.g. `"consultation:<patientId>"`). The
 *              module sanitizes and namespaces this for localStorage.
 * @param value Anything JSON-serializable. Functions / cyclic refs throw.
 * @param ttlMs How long the draft is considered valid on read. Defaults to
 *              24h. Drafts past TTL are removed lazily on the next `loadDraft`.
 */
export async function saveDraft(
  key: string,
  value: unknown,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  if (!hasWindow()) return;
  const sk = storageKey(key);

  if (!hasSubtleCrypto()) {
    warnUnavailableCryptoOnce();
    return;
  }

  const cryptoKey = await getOrCreateKey();
  if (!cryptoKey) return; // no crypto, no window — nothing to do

  try {
    const ciphertext = await encryptJson(value, cryptoKey);
    const record: PersistedDraft = { savedAt: Date.now(), ttlMs, ciphertext };
    window.localStorage.setItem(sk, JSON.stringify(record));
  } catch {
    // Storage full / blocked. Failing silently mirrors the previous behaviour;
    // the form keeps working in-memory.
  }
}

/**
 * Read and decrypt a draft. Returns `null` if:
 *   - nothing was saved under that key,
 *   - the draft is past its TTL (also removed from storage as a side-effect),
 *   - decryption failed (per-tab key was lost on tab close, draft was
 *     tampered with, etc).
 */
export async function loadDraft<T = unknown>(key: string): Promise<T | null> {
  if (!hasWindow()) return null;
  const sk = storageKey(key);

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(sk);
  } catch {
    return null;
  }
  if (!raw) return null;

  let record: PersistedDraft;
  try {
    record = JSON.parse(raw) as PersistedDraft;
  } catch {
    // Corrupt envelope — drop it.
    try { window.localStorage.removeItem(sk); } catch { /* ignore */ }
    return null;
  }

  // Lazy expiry.
  if (
    typeof record.savedAt === 'number' &&
    typeof record.ttlMs === 'number' &&
    Date.now() - record.savedAt > record.ttlMs
  ) {
    try { window.localStorage.removeItem(sk); } catch { /* ignore */ }
    return null;
  }

  // Remove records written by the legacy plaintext fallback. Never return PHI
  // from them, even in development: an insecure context must fail closed.
  if (
    typeof record.ciphertext === 'string' &&
    record.ciphertext.startsWith(LEGACY_PLAINTEXT_PREFIX)
  ) {
    try { window.localStorage.removeItem(sk); } catch { /* ignore */ }
    return null;
  }

  if (!hasSubtleCrypto()) {
    // Saved encrypted, but we can no longer decrypt — treat as missing.
    return null;
  }

  const cryptoKey = await getOrCreateKey();
  if (!cryptoKey) return null;

  try {
    return await decryptJson<T>(record.ciphertext, cryptoKey);
  } catch {
    // Wrong key (tab closed and we just made a new one), tampered ciphertext,
    // or auth-tag mismatch. All the same to the caller: there's no usable
    // draft here.
    return null;
  }
}

/**
 * Remove a specific draft from storage. Safe to call on a key that doesn't
 * exist.
 */
export async function dropDraft(key: string): Promise<void> {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // ignore — best effort
  }
}

/**
 * Drop every draft this module has ever written, in any tab on this origin.
 * Used on logout so the next user on a shared device can't recover drafts
 * even if they refresh into a session where the encryption key is somehow
 * still around (it shouldn't be — sessionStorage dies with the tab — but
 * defence in depth).
 *
 * Iterates `localStorage` looking for the namespace prefix and removes them.
 * Also clears the sessionStorage key so any subsequent saves in the same tab
 * mint a fresh one (i.e. unrelated to whatever encrypted blobs we may have
 * just orphaned).
 */
export async function dropAllDrafts(): Promise<void> {
  if (!hasWindow()) return;
  try {
    const ls = window.localStorage;
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) {
      try { ls.removeItem(k); } catch { /* ignore */ }
    }
  } catch {
    // ignore — best effort
  }
  try {
    window.sessionStorage.removeItem(SESSION_KEY_NAME);
  } catch {
    // ignore — best effort
  }
}

// Exposed for tests only. Not part of the public API.
export const __INTERNAL__ = {
  STORAGE_PREFIX,
  SESSION_KEY_NAME,
  LEGACY_PLAINTEXT_PREFIX,
  storageKey,
};
