/**
 * Organisation data keys — encryption for fields that replicate to devices.
 *
 * `field-encryption.ts` holds its key on the server only, so it has to switch
 * itself off wherever browsers sync (every production deployment): a device
 * that pulls a server-encrypted field has nothing to read it with. This layer
 * is the one that works with sync on. Each organisation has its own AES-256
 * key; the device that writes a field encrypts it, CouchDB and its backups
 * hold ciphertext, and any signed-in member of the organisation can read it.
 * `lib/encrypted-db.ts` applies it to every patient-data field the catalog
 * (`lib/phi-field-catalog.json`) names, at the database boundary.
 *
 * Keys are DERIVED, never stored: HKDF-SHA256 over one server secret
 * (`ORG_DATA_KEY_SECRET`) with the organisation id as context. Backing up that
 * one secret backs up every organisation's key; losing it loses every
 * encrypted field. A device receives its organisation's key from
 * `GET /api/crypto/org-key` after sign-in and keeps it in IndexedDB as a
 * non-extractable CryptoKey — readable offline, not exportable by script —
 * until sign-out.
 *
 * What this does NOT protect: the device itself. The key sits in the same
 * browser profile as the data, so someone holding an unlocked, signed-in
 * device can read what that user can read. What it adds is that the server,
 * its replicas, its backups and the analytics copy hold only ciphertext.
 *
 * Envelopes:
 *   `oenc:v1:<org b64url>:<iv>:<ciphertext+tag>` — one organisation; the
 *     organisation id is the AES-GCM additional data, so an envelope cannot
 *     be moved onto another organisation's record and still open.
 *   `oencm:v1:<orgs b64url>:<wrapped keys>:<iv>:<ciphertext+tag>` — a record
 *     addressed to more than one organisation (a cross-organisation referral
 *     or transfer). The text is sealed once under a random key, and that key
 *     is wrapped under each organisation's key.
 */

const PREFIX = 'oenc:v1:';
const MULTI_PREFIX = 'oencm:v1:';
const KEY_VERSION = 'v1';
const HKDF_SALT = 'tamamhealth/org-data-key';
const INDEX_INFO = 'blind-index:v1';
const IV_BYTES = 12;

/** The key for records that belong to no organisation (platform-level staff). */
export const PLATFORM_KEY_ID = '_platform';

/** Keystore entry for the blind-index key (see `blindIndex`). */
const INDEX_KEY_ID = '_index';

/** Development-only secret; production refuses to boot without a real one. */
const DEV_SECRET = 'tamamhealth-development-org-data-key-secret-not-for-production';

/** Shown in place of a field this device cannot decrypt. */
export const UNREADABLE_ORG_FIELD_TEXT = '[Encrypted — sign in online once on this device to read it.]';

export class OrgKeyUnavailableError extends Error {
  constructor(orgId: string) {
    super(`The encryption key for organisation ${orgId} is not on this device. Sign in while online to set it up.`);
    this.name = 'OrgKeyUnavailableError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Web Crypto is not available in this runtime.');
  return s;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const toB64Url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64UrlBytes = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
const strToB64Url = (s: string) => toB64Url(enc.encode(s));
const strFromB64Url = (s: string) => dec.decode(fromB64UrlBytes(s));

/** The id a record's fields are encrypted under. */
export function orgKeyIdFor(orgId: string | undefined | null): string {
  return orgId && orgId.trim() ? orgId : PLATFORM_KEY_ID;
}

/* ─────────────────────────── default organisation ─────────────────────────── */

let defaultKeyId: string | null = null;

/**
 * The signed-in user's organisation on this device. A record written without
 * an `orgId` is sealed under it, so its own organisation can still read it —
 * the platform key is issued only to platform accounts.
 */
export function setDefaultOrgKeyId(keyId: string | null): void {
  defaultKeyId = keyId;
}

/** The organisations a record's fields are sealed for. */
export function recipientKeyIds(orgId: string | undefined | null, alsoFor: Array<string | undefined | null> = []): string[] {
  const primary = orgId && orgId.trim() ? orgId : (defaultKeyId ?? PLATFORM_KEY_ID);
  const out = [primary];
  for (const extra of alsoFor) {
    if (extra && extra.trim() && !out.includes(extra)) out.push(extra);
  }
  return out;
}

/* ─────────────────────────── envelope inspection ─────────────────────────── */

/** True if a value is in one of this layer's envelopes. */
export function isOrgEncrypted(value: unknown): boolean {
  return typeof value === 'string' && (value.startsWith(PREFIX) || value.startsWith(MULTI_PREFIX));
}

/** The organisations an envelope can be opened by (empty if it is not one). */
export function envelopeOrgIds(value: string): string[] {
  try {
    if (value.startsWith(PREFIX)) {
      const part = value.slice(PREFIX.length).split(':')[0];
      return part ? [strFromB64Url(part)] : [];
    }
    if (value.startsWith(MULTI_PREFIX)) {
      const part = value.slice(MULTI_PREFIX.length).split(':')[0];
      return part ? (JSON.parse(strFromB64Url(part)) as string[]) : [];
    }
  } catch { /* malformed */ }
  return [];
}

/** The (first) organisation an envelope was written for, or null if it is not one. */
export function envelopeOrgId(value: string): string | null {
  return envelopeOrgIds(value)[0] ?? null;
}

/* ─────────────────────────── key derivation (server) ─────────────────────────── */

/**
 * The master secret, where this runtime may hold it: always on the server
 * (with a development fallback outside production), and in the browser never
 * — a client bundle has no `ORG_DATA_KEY_SECRET`, so it falls to the keystore.
 */
function masterSecret(): string | null {
  const configured = typeof process !== 'undefined' ? process.env.ORG_DATA_KEY_SECRET : undefined;
  if (configured) return configured;
  if (typeof window !== 'undefined') return null;
  // The standalone demo runs a production build with no datastore and no real
  // record (config-validation refuses demo mode alongside CouchDB), so it may
  // use the fallback; any other production server must be configured.
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    throw new Error('ORG_DATA_KEY_SECRET is not set — organisation data keys cannot be derived.');
  }
  return DEV_SECRET;
}

/** Whether this runtime derives keys itself (the server) rather than holding issued ones. */
export function derivesKeysLocally(): boolean {
  try { return masterSecret() !== null; } catch { return false; }
}

async function hkdf(info: string): Promise<Uint8Array<ArrayBuffer>> {
  const secret = masterSecret();
  if (!secret) throw new OrgKeyUnavailableError(info);
  const base = await subtle().importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(info) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** The raw 32 key bytes for one organisation. Server only — the endpoint hands these out. */
export function deriveOrgKeyBytes(orgId: string): Promise<Uint8Array<ArrayBuffer>> {
  return hkdf(`org:${orgId}:${KEY_VERSION}`);
}

/** The raw blind-index key bytes. One for the platform: matching is cross-organisation. */
export function deriveIndexKeyBytes(): Promise<Uint8Array<ArrayBuffer>> {
  return hkdf(INDEX_INFO);
}

function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  // Non-extractable: once imported, script on the page can use the key but
  // cannot read it back out.
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function importHmacKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/* ─────────────────────────── device keystore (browser) ─────────────────────────── */

const KEYSTORE_DB = 'tamamhealth-org-keys';
const KEYSTORE_STORE = 'keys';

function openKeystoreAt(version?: number): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const req = version === undefined ? indexedDB.open(KEYSTORE_DB) : indexedDB.open(KEYSTORE_DB, version);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(KEYSTORE_STORE)) req.result.createObjectStore(KEYSTORE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * The keystore, with its object store guaranteed. A database that already
 * exists without the store — created by anything that opened the name first,
 * or an upgrade that was interrupted — would never run `onupgradeneeded` at
 * the same version, and every key write would fail silently for good; so a
 * missing store is repaired by reopening one version higher.
 */
async function openKeystore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openKeystoreAt();
  if (!db) return null;
  if (db.objectStoreNames.contains(KEYSTORE_STORE)) return db;
  const next = db.version + 1;
  db.close();
  return openKeystoreAt(next);
}

async function keystoreGet(id: string): Promise<CryptoKey | null> {
  const db = await openKeystore();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const req = db.transaction(KEYSTORE_STORE, 'readonly').objectStore(KEYSTORE_STORE).get(id);
      req.onsuccess = () => { db.close(); resolve((req.result as CryptoKey | undefined) ?? null); };
      req.onerror = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function keystorePut(id: string, key: CryptoKey): Promise<void> {
  const db = await openKeystore();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(KEYSTORE_STORE, 'readwrite');
      tx.objectStore(KEYSTORE_STORE).put(key, id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch {
      db.close();
      resolve();
    }
  });
}

/**
 * Fetch an organisation's key (and the blind-index key that rides with it)
 * from the server and keep both on this device.
 */
async function fetchAndStore(orgId: string): Promise<CryptoKey | null> {
  if (typeof fetch === 'undefined' || typeof window === 'undefined') return null;
  try {
    const res = await fetch(`/api/crypto/org-key?orgId=${encodeURIComponent(orgId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json() as { key?: string; indexKey?: string };
    if (!body.key) return null;
    const key = await importAesKey(fromB64(body.key));
    await keystorePut(orgId, key);
    if (body.indexKey) {
      const indexKey = await importHmacKey(fromB64(body.indexKey));
      await keystorePut(INDEX_KEY_ID, indexKey);
      keyCache.set(INDEX_KEY_ID, Promise.resolve(indexKey));
    }
    return key;
  } catch {
    return null;
  }
}

/* ─────────────────────────── key resolution ─────────────────────────── */

const keyCache = new Map<string, Promise<CryptoKey | null>>();

async function resolveKey(keyId: string): Promise<CryptoKey | null> {
  if (derivesKeysLocally()) return importAesKey(await deriveOrgKeyBytes(keyId));
  return (await keystoreGet(keyId)) ?? (await fetchAndStore(keyId));
}

/** This device's key for an organisation, or null when it has none and cannot get one now. */
async function getOrgKey(keyId: string): Promise<CryptoKey | null> {
  let pending = keyCache.get(keyId);
  if (!pending) {
    pending = resolveKey(keyId);
    keyCache.set(keyId, pending);
  }
  const key = await pending;
  // A miss is not remembered: the device may come online a moment later.
  if (!key) keyCache.delete(keyId);
  return key;
}

async function getIndexKey(): Promise<CryptoKey | null> {
  let pending = keyCache.get(INDEX_KEY_ID);
  if (!pending) {
    pending = derivesKeysLocally()
      ? deriveIndexKeyBytes().then(importHmacKey)
      : keystoreGet(INDEX_KEY_ID);
    keyCache.set(INDEX_KEY_ID, pending);
  }
  const key = await pending;
  if (!key) keyCache.delete(INDEX_KEY_ID);
  return key;
}

/**
 * Make sure this device holds an organisation's key — called after sign-in so
 * the key is in place before the device next goes offline. Returns whether it
 * is now available.
 */
export async function provisionOrgKey(orgId: string): Promise<boolean> {
  return (await getOrgKey(orgId)) !== null;
}

/** Forget every organisation key on this device — sign-out, session end, user switch. */
export async function clearOrgKeys(): Promise<void> {
  keyCache.clear();
  plainCache.clear();
  defaultKeyId = null;
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>(resolve => {
    try {
      const req = indexedDB.deleteDatabase(KEYSTORE_DB);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* ─────────────────────────── encrypt / decrypt ─────────────────────────── */

/**
 * Decrypted values, keyed by envelope. An envelope is unique (random IV), so
 * this can never return the wrong text; it spares the list screens from
 * re-decrypting every patient on every live reload.
 */
const plainCache = new Map<string, string>();
const PLAIN_CACHE_LIMIT = 50_000;

function remember(envelope: string, plaintext: string): void {
  if (plainCache.size >= PLAIN_CACHE_LIMIT) {
    const oldest = plainCache.keys().next().value;
    if (oldest !== undefined) plainCache.delete(oldest);
  }
  plainCache.set(envelope, plaintext);
}

const aad = (keyIds: string[]) => enc.encode(keyIds.length === 1 ? `tamamhealth:${keyIds[0]}` : `tamamhealth:m:${keyIds.join('|')}`);

/**
 * Encrypt a field for one or more organisations. Idempotent: a value already
 * in an envelope (this layer's or the retired server-only `enc:v1:`) is
 * returned unchanged — re-encrypting would give different bytes, and the sync
 * validators compare stored values exactly. Throws `OrgKeyUnavailableError`
 * rather than ever storing plaintext.
 */
export async function encryptForOrgs(plaintext: string, keyIds: string[]): Promise<string> {
  if (!plaintext || isOrgEncrypted(plaintext) || plaintext.startsWith('enc:v1:')) return plaintext;
  const ids = keyIds.length ? keyIds : [orgKeyIdFor(null)];
  if (ids.length === 1) {
    const key = await getOrgKey(ids[0]);
    if (!key) throw new OrgKeyUnavailableError(ids[0]);
    const iv = randomBytes(IV_BYTES);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(ids) }, key, enc.encode(plaintext)));
    const out = `${PREFIX}${strToB64Url(ids[0])}:${toB64(iv)}:${toB64(ct)}`;
    remember(out, plaintext);
    return out;
  }
  // Several organisations: one random data key, wrapped under each of theirs.
  const dataKeyBytes = randomBytes(32);
  const dataKey = await importAesKey(dataKeyBytes);
  const wrapped: string[] = [];
  for (const id of ids) {
    const key = await getOrgKey(id);
    if (!key) throw new OrgKeyUnavailableError(id);
    const wiv = randomBytes(IV_BYTES);
    const wct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: wiv, additionalData: aad([id]) }, key, dataKeyBytes));
    wrapped.push(`${toB64Url(wiv)}.${toB64Url(wct)}`);
  }
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(ids) }, dataKey, enc.encode(plaintext)));
  const out = `${MULTI_PREFIX}${strToB64Url(JSON.stringify(ids))}:${wrapped.join(',')}:${toB64(iv)}:${toB64(ct)}`;
  remember(out, plaintext);
  return out;
}

/** Encrypt a field for one organisation (see `encryptForOrgs`). */
export function encryptForOrg(plaintext: string, orgId: string | undefined | null): Promise<string> {
  return encryptForOrgs(plaintext, [orgKeyIdFor(orgId)]);
}

/** Decrypt an envelope. Throws when no key opens it or the ciphertext was altered. */
export async function decryptForOrg(value: string): Promise<string> {
  if (!isOrgEncrypted(value)) return value;
  const cached = plainCache.get(value);
  if (cached !== undefined) return cached;

  let plaintext: string;
  if (value.startsWith(PREFIX)) {
    const [orgPart, ivB64, ctB64] = value.slice(PREFIX.length).split(':');
    if (!orgPart || !ivB64 || !ctB64) throw new Error('Malformed organisation envelope.');
    const keyId = strFromB64Url(orgPart);
    const key = await getOrgKey(keyId);
    if (!key) throw new OrgKeyUnavailableError(keyId);
    plaintext = dec.decode(await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64), additionalData: aad([keyId]) }, key, fromB64(ctB64),
    ));
  } else {
    const [orgsPart, wrappedPart, ivB64, ctB64] = value.slice(MULTI_PREFIX.length).split(':');
    if (!orgsPart || !wrappedPart || !ivB64 || !ctB64) throw new Error('Malformed organisation envelope.');
    const ids = JSON.parse(strFromB64Url(orgsPart)) as string[];
    const wrapped = wrappedPart.split(',');
    let dataKey: CryptoKey | null = null;
    // Prefer a key already on hand, so a member never triggers a fetch for
    // the other organisation's key just to read their own record.
    const order = [...ids.keys()].sort((a, b) => Number(keyCache.has(ids[b])) - Number(keyCache.has(ids[a])));
    for (const i of order) {
      const key = await getOrgKey(ids[i]).catch(() => null);
      if (!key || !wrapped[i]) continue;
      const [wiv, wct] = wrapped[i].split('.');
      try {
        const raw = new Uint8Array(await subtle().decrypt(
          { name: 'AES-GCM', iv: fromB64UrlBytes(wiv), additionalData: aad([ids[i]]) }, key, fromB64UrlBytes(wct),
        ));
        dataKey = await importAesKey(raw);
        break;
      } catch { /* try the next organisation */ }
    }
    if (!dataKey) throw new OrgKeyUnavailableError(ids.join(', '));
    plaintext = dec.decode(await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64), additionalData: aad(ids) }, dataKey, fromB64(ctB64),
    ));
  }
  remember(value, plaintext);
  return plaintext;
}

/**
 * Read a field for display without letting one unreadable value take a whole
 * list down: plaintext passes through, an envelope this device cannot open
 * reads as a placeholder.
 */
export async function readOrgField(value: string): Promise<string> {
  if (!isOrgEncrypted(value)) return value;
  try {
    return await decryptForOrg(value);
  } catch {
    return UNREADABLE_ORG_FIELD_TEXT;
  }
}

/* ─────────────────────────── blind index ─────────────────────────── */

/** Normalise an identifier before indexing: case, spaces and separators do not distinguish people. */
export function normaliseForIndex(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[\s\-_./]/g, '');
}

/**
 * A keyed fingerprint of an identifier (HMAC-SHA256), stored beside its
 * encrypted value so exact-match lookups — the MPI's national-ID tier — still
 * work as a database query. It reveals only that two records share a value,
 * never the value. The key is one for the platform, because patient matching
 * crosses organisations. Returns null where this device holds no index key.
 */
export async function blindIndex(value: string): Promise<string | null> {
  const normalised = normaliseForIndex(value);
  if (!normalised) return null;
  const key = await getIndexKey();
  if (!key) return null;
  const mac = new Uint8Array(await subtle().sign('HMAC', key, enc.encode(normalised)));
  return `bi1_${toB64Url(mac)}`;
}
