/**
 * Patient data encrypted at the database boundary.
 *
 * `getDB()` (lib/db.ts) hands app and server code a proxy over each PouchDB
 * database. Reads come back decrypted; writes are encrypted, field by field,
 * per `phi-field-catalog.json`, under the record's organisation key
 * (lib/org-data-cipher.ts). Everything underneath — the IndexedDB store on the
 * device, replication, CouchDB, its backups — only ever sees ciphertext.
 * Replication uses the raw instance (`getRawDB`), so it moves envelopes, never
 * text.
 *
 * Three rules make this safe to put under a synced, validated record:
 *
 *  1. An unchanged field keeps its exact stored envelope. Encryption is
 *     randomised, so re-encrypting a value the user did not touch would make
 *     it look edited — and the sync validators refuse amend-only roles that
 *     "edit" fields outside their grant (a pharmacist recording a dispense, a
 *     nurse charting on an admission, a colleague marking a message read).
 *     So every update is compared with the stored revision first.
 *  2. A field this device could not decrypt is never written back as its
 *     placeholder; the stored envelope is kept.
 *  3. A value query on an encrypted field is refused loudly. It could only
 *     ever match nothing, which would fail silently (a duplicate check that
 *     finds no duplicates). Exact-match lookups go through a blind index.
 */
import catalog from './phi-field-catalog.json';
import {
  UNREADABLE_ORG_FIELD_TEXT,
  blindIndex,
  derivesKeysLocally,
  encryptForOrgs,
  envelopeOrgIds,
  isOrgEncrypted,
  readOrgField,
  recipientKeyIds,
} from './org-data-cipher';

const UNREADABLE_SERVER_FIELD_TEXT = '[Encrypted on the server — cannot be read on this device.]';

interface TypeSpec {
  fields: string[];
  alsoFor?: string[];
  blindIndex?: Record<string, string>;
}

type Segment = { key: string; each: boolean } | '**';

const SPECS = (catalog as { types: Record<string, TypeSpec> }).types;

const COMPILED: Record<string, Segment[][]> = Object.fromEntries(
  Object.entries(SPECS).map(([type, spec]) => [
    type,
    spec.fields.map(pattern => pattern.split('.').map((part): Segment =>
      part === '**' ? '**' : part.endsWith('[]') ? { key: part.slice(0, -2), each: true } : { key: part, each: false },
    )),
  ]),
);

/** The document types whose fields are encrypted. */
export function encryptedTypes(): string[] {
  return Object.keys(SPECS);
}

/** Top-level field names a type encrypts — what a selector may not filter on. */
export function encryptedTopLevelFields(type: string): Set<string> {
  const out = new Set<string>();
  for (const segments of COMPILED[type] ?? []) {
    const first = segments[0];
    if (first && first !== '**') out.add(first.key);
  }
  return out;
}

type Path = Array<string | number>;
interface Leaf { path: Path; value: string }

function deepStrings(node: unknown, path: Path, out: Leaf[]): void {
  if (typeof node === 'string') { out.push({ path, value: node }); return; }
  if (Array.isArray(node)) { node.forEach((item, i) => deepStrings(item, [...path, i], out)); return; }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!key.startsWith('_')) deepStrings(value, [...path, key], out);
    }
  }
}

function walk(node: unknown, segments: Segment[], i: number, path: Path, out: Leaf[]): void {
  if (node === undefined || node === null) return;
  if (i === segments.length) {
    if (typeof node === 'string') out.push({ path, value: node });
    else if (Array.isArray(node)) node.forEach((item, j) => { if (typeof item === 'string') out.push({ path: [...path, j], value: item }); });
    return;
  }
  const seg = segments[i];
  if (seg === '**') { deepStrings(node, path, out); return; }
  if (typeof node !== 'object' || Array.isArray(node)) return;
  const child = (node as Record<string, unknown>)[seg.key];
  if (seg.each) {
    if (Array.isArray(child)) child.forEach((item, j) => walk(item, segments, i + 1, [...path, seg.key, j], out));
    return;
  }
  walk(child, segments, i + 1, [...path, seg.key], out);
}

/** Every string a type's catalog entry covers in this document. */
function encryptedLeaves(doc: Record<string, unknown>): Leaf[] {
  const out: Leaf[] = [];
  for (const segments of COMPILED[doc.type as string] ?? []) walk(doc, segments, 0, [], out);
  return out;
}

const pathKey = (path: Path) => path.join('\u0001');

function setAt(target: Record<string, unknown>, path: Path, value: string): void {
  let node: Record<string | number, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]] as Record<string | number, unknown>;
  node[path[path.length - 1]] = value;
}

/** Copy a document deeply enough that writing leaves never touches the caller's object. */
function clone<T>(doc: T): T {
  return typeof structuredClone === 'function' ? structuredClone(doc) : JSON.parse(JSON.stringify(doc));
}

/* ─────────────────────────── switches ─────────────────────────── */

let bypassDepth = 0;

/**
 * Run writes without encryption — for the demo seed only, which writes
 * fictional records before anyone has signed in (so before any key is on the
 * device). Readers pass plaintext through, so seeded data still displays.
 */
export async function runWithoutEncryption<T>(fn: () => Promise<T>): Promise<T> {
  bypassDepth++;
  try { return await fn(); } finally { bypassDepth--; }
}

/**
 * The emergency switch. On unless `NEXT_PUBLIC_PHI_ENCRYPTION=false`. Reads
 * always decrypt, and even switched off a field that is already sealed stays
 * sealed (see `encryptDocument`) — it only stops sealing new plaintext.
 */
function encryptionEnabled(): boolean {
  return bypassDepth === 0 && process.env.NEXT_PUBLIC_PHI_ENCRYPTION !== 'false';
}

/* ─────────────────────────── read side ─────────────────────────── */

const requestedRekeys = new Set<string>();

/**
 * A record whose fields are sealed for an organisation it no longer belongs
 * to — a patient re-homed by a cross-organisation referral — cannot be read
 * by its new organisation. Ask the server, which holds every key, to re-seal
 * it. Once per record per session; the server checks the caller's claim.
 */
function requestRekey(dbName: string, doc: Record<string, unknown>, envelopes: string[]): void {
  if (typeof window === 'undefined' || derivesKeysLocally()) return;
  const orgId = typeof doc.orgId === 'string' ? doc.orgId : '';
  const id = typeof doc._id === 'string' ? doc._id : '';
  if (!orgId || !id) return;
  if (!envelopes.some(env => !envelopeOrgIds(env).includes(orgId))) return;
  const key = `${dbName}/${id}`;
  if (requestedRekeys.has(key)) return;
  requestedRekeys.add(key);
  void import('./api-fetch')
    .then(({ apiFetch }) => apiFetch('/api/crypto/rekey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: dbName, id }),
    }))
    .catch(() => { requestedRekeys.delete(key); });
}

/** Every envelope in a document, decrypted in place (on a copy). Unreadable ones become a placeholder. */
export async function decryptDocument<T>(doc: T, dbName = ''): Promise<T> {
  if (!doc || typeof doc !== 'object') return doc;
  const leaves: Leaf[] = [];
  deepStrings(doc, [], leaves);
  const sealed = leaves.filter(leaf => isOrgEncrypted(leaf.value));
  if (sealed.length === 0) return doc;
  const out = clone(doc) as Record<string, unknown>;
  await Promise.all(sealed.map(async leaf => setAt(out, leaf.path, await readOrgField(leaf.value))));
  if (dbName) requestRekey(dbName, doc as Record<string, unknown>, sealed.map(leaf => leaf.value));
  return out as T;
}

/* ─────────────────────────── write side ─────────────────────────── */

const isPlaceholder = (value: string) => value === UNREADABLE_ORG_FIELD_TEXT || value === UNREADABLE_SERVER_FIELD_TEXT;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

/**
 * Encrypt a document for storage. `stored` is the revision it replaces (raw,
 * as held), used to keep unchanged envelopes byte-for-byte.
 */
export async function encryptDocument<T extends Record<string, unknown>>(
  doc: T,
  stored?: Record<string, unknown> | null,
): Promise<T> {
  if (!doc || typeof doc !== 'object' || doc._deleted === true) return doc;
  const type = doc.type as string | undefined;
  const spec = type ? SPECS[type] : undefined;
  if (!spec || bypassDepth > 0) return doc;

  // Leaves are walked even with writing switched off: a field that is already
  // encrypted stays encrypted (rule 1 below), or switching the rollout off
  // would quietly decrypt the record at rest on its next save — and make every
  // untouched field look edited to the sync validators.
  const encrypting = encryptionEnabled();
  const leaves = encryptedLeaves(doc);
  const indexes = Object.entries(spec.blindIndex ?? {});
  if (leaves.length === 0 && indexes.length === 0) return doc;

  const out = clone(doc) as Record<string, unknown>;
  const keyIds = recipientKeyIds(
    doc.orgId as string | undefined,
    (spec.alsoFor ?? []).map(field => doc[field] as string | undefined),
  );

  const storedLeaves = new Map<string, string>();
  if (stored) {
    const all: Leaf[] = [];
    deepStrings(stored, [], all);
    for (const leaf of all) storedLeaves.set(pathKey(leaf.path), leaf.value);
  }

  // Blind indexes are computed from the plaintext, before it is sealed.
  for (const [field, indexField] of indexes) {
    const value = doc[field];
    if (typeof value !== 'string' || !value.trim()) { delete out[indexField]; continue; }
    if (isOrgEncrypted(value) || isPlaceholder(value)) continue; // unchanged: keep the stored index
    const index = await blindIndex(value);
    if (index) out[indexField] = index;
  }

  await Promise.all(leaves.map(async ({ path, value }) => {
    if (!value || isOrgEncrypted(value) || value.startsWith('enc:v1:')) return;
    const previous = storedLeaves.get(pathKey(path));
    const wasSealed = previous !== undefined && isOrgEncrypted(previous);
    if (!encrypting && !wasSealed && !isPlaceholder(value)) return; // rollout off, never sealed: leave as written
    if (isPlaceholder(value)) {
      // Rule 2: never overwrite ciphertext with the placeholder shown in its place.
      if (previous !== undefined) { setAt(out, path, previous); return; }
      throw new Error('This record has a field that cannot be read on this device, so it cannot be saved from it.');
    }
    // Rule 3: an untouched field still stored in plaintext (written before the
    // rollout, or seeded) stays as stored. Sealing it here would make an
    // amend-only role's save change a field it may not touch — a pharmacist
    // clearing an order "edited" patientName and the validator refused the
    // whole document. Records at rest are sealed by the server-side migration.
    if (previous !== undefined && !isOrgEncrypted(previous) && previous === value) return;
    // Rule 1: an untouched field keeps the envelope it already has.
    if (previous && isOrgEncrypted(previous) && sameSet(envelopeOrgIds(previous), keyIds)) {
      if ((await readOrgField(previous)) === value) { setAt(out, path, previous); return; }
    }
    setAt(out, path, await encryptForOrgs(value, keyIds));
  }));
  return out as T;
}

/* ─────────────────────────── query guard ─────────────────────────── */

function assertQueryable(selector: Record<string, unknown> | undefined): void {
  if (!selector || typeof selector.type !== 'string') return;
  const sealed = encryptedTopLevelFields(selector.type);
  if (sealed.size === 0) return;
  const keys = new Set<string>();
  const collect = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$and' || key === '$or' || key === '$nor') { (value as unknown[]).forEach(collect); continue; }
      if (!key.startsWith('$')) keys.add(key.split('.')[0]);
    }
  };
  collect(selector);
  for (const key of keys) {
    if (sealed.has(key)) {
      throw new Error(
        `Cannot query ${selector.type}.${key}: it is encrypted at rest, so a database match on its value would always be empty. `
        + 'Load by an id and filter after reading, or use its blind index.',
      );
    }
  }
}

/* ─────────────────────────── the proxy ─────────────────────────── */

type AnyDoc = Record<string, unknown> & { _id?: string; _rev?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pouch = any;

async function storedRevisions(raw: Pouch, docs: AnyDoc[]): Promise<Map<string, AnyDoc>> {
  const ids = docs.filter(doc => doc._id && doc._rev && SPECS[doc.type as string]).map(doc => doc._id as string);
  const out = new Map<string, AnyDoc>();
  if (ids.length === 0) return out;
  try {
    const res = await raw.allDocs({ keys: ids, include_docs: true });
    for (const row of res.rows as Array<{ doc?: AnyDoc }>) if (row.doc?._id) out.set(row.doc._id, row.doc);
  } catch { /* no stored copy: every field is encrypted fresh */ }
  return out;
}

const WRAPPED = Symbol.for('tamamhealth.encrypted-db');

/** Wrap a PouchDB database so callers read plaintext and storage holds ciphertext. */
export function wrapEncrypted<D extends object>(raw: D, dbName: string): D {
  if ((raw as Record<symbol, unknown>)[WRAPPED]) return raw;
  const db = raw as Pouch;
  const overrides: Record<string, unknown> = {
    [WRAPPED]: true,
    async get(id: string, opts?: unknown) {
      const doc = opts === undefined ? await db.get(id) : await db.get(id, opts);
      return decryptDocument(doc, dbName);
    },
    async allDocs(opts?: { include_docs?: boolean }) {
      const res = opts === undefined ? await db.allDocs() : await db.allDocs(opts);
      if (!opts?.include_docs) return res;
      res.rows = await Promise.all(res.rows.map(async (row: { doc?: AnyDoc }) => (
        row.doc ? { ...row, doc: await decryptDocument(row.doc, dbName) } : row
      )));
      return res;
    },
    async find(request: { selector?: Record<string, unknown> }) {
      assertQueryable(request?.selector);
      const res = await db.find(request);
      res.docs = await Promise.all(res.docs.map((doc: AnyDoc) => decryptDocument(doc, dbName)));
      return res;
    },
    async bulkGet(opts: unknown) {
      const res = await db.bulkGet(opts);
      for (const result of res.results as Array<{ docs: Array<{ ok?: AnyDoc }> }>) {
        result.docs = await Promise.all(result.docs.map(async entry => (
          entry.ok ? { ok: await decryptDocument(entry.ok, dbName) } : entry
        )));
      }
      return res;
    },
    async put(doc: AnyDoc, opts?: unknown) {
      const stored = (await storedRevisions(db, [doc])).get(doc._id as string);
      const sealed = await encryptDocument(doc, stored);
      return opts === undefined ? db.put(sealed) : db.put(sealed, opts);
    },
    async post(doc: AnyDoc, opts?: unknown) {
      const sealed = await encryptDocument(doc, null);
      return opts === undefined ? db.post(sealed) : db.post(sealed, opts);
    },
    async bulkDocs(input: AnyDoc[] | { docs: AnyDoc[] }, opts?: { new_edits?: boolean }) {
      // new_edits:false is replication's write path: those are stored
      // revisions arriving as they are, never plaintext from the app.
      if (opts?.new_edits === false) return db.bulkDocs(input, opts);
      const docs = Array.isArray(input) ? input : input.docs;
      const stored = await storedRevisions(db, docs);
      const sealed = await Promise.all(docs.map(doc => encryptDocument(doc, stored.get(doc._id as string))));
      const payload = Array.isArray(input) ? sealed : { ...input, docs: sealed };
      return opts === undefined ? db.bulkDocs(payload) : db.bulkDocs(payload, opts);
    },
  };
  const isOverride = (prop: string | symbol): prop is string => typeof prop === 'string' && prop in overrides;
  return new Proxy(raw, {
    get(target, prop) {
      if (isOverride(prop)) return overrides[prop];
      if (prop === WRAPPED) return true;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    // Assigning one of the wrapped methods replaces the wrapped one (how a
    // test spies on `db.put`); anything else lands on the database itself.
    set(target, prop, value) {
      if (isOverride(prop)) { overrides[prop] = value; return true; }
      return Reflect.set(target, prop, value);
    },
    defineProperty(target, prop, descriptor) {
      if (isOverride(prop) && 'value' in descriptor) { overrides[prop] = descriptor.value; return true; }
      return Reflect.defineProperty(target, prop, descriptor);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (isOverride(prop)) return { value: overrides[prop], writable: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
}
