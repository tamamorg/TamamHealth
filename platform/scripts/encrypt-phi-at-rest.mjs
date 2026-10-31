#!/usr/bin/env node
/**
 * One-time encryption of patient data already stored in plaintext.
 *
 * From 2026-10-17 the database layer (src/lib/encrypted-db.ts) seals every
 * field named in src/lib/phi-field-catalog.json under the record's
 * organisation key before it is stored or replicated. Records written before
 * that are still plaintext in CouchDB. This walks every `tamamhealth_*`
 * database (shared and per-organisation), seals each catalogued field that is
 * still plaintext, writes the national-ID blind index, and compacts each
 * database so the earlier plaintext revisions are purged from disk.
 *
 * Values already sealed (`oenc:v1:` / `oencm:v1:`) or in the retired
 * server-only envelope (`enc:v1:`) are left exactly as they are, so the
 * script can be re-run safely and never disturbs what devices wrote.
 *
 * The cryptography below MUST match src/lib/org-data-cipher.ts byte for byte;
 * src/__tests__/security/org-data-cipher.test.ts runs this file's own code and
 * opens its output with the app's.
 *
 * Run it at a quiet time: a device still holding a plaintext revision that
 * writes before it pulls the sealed one may have that one write refused by a
 * sync validator, and retries after its next pull (~15 s).
 *
 * Usage:
 *   DRY_RUN=true  node scripts/encrypt-phi-at-rest.mjs   # preview (default)
 *   DRY_RUN=false node scripts/encrypt-phi-at-rest.mjs   # apply
 *
 * Env: COUCHDB_URL (default http://localhost:5984),
 *      COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD (required),
 *      ORG_DATA_KEY_SECRET (required — the same value the app runs with).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(here, '../src/lib/phi-field-catalog.json'), 'utf8'));

const PREFIX = 'oenc:v1:';
const MULTI_PREFIX = 'oencm:v1:';
const PLATFORM_KEY_ID = '_platform';
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const b64 = bytes => Buffer.from(bytes).toString('base64');
const b64url = bytes => Buffer.from(bytes).toString('base64url');
const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

const isSealed = v => typeof v === 'string' && (v.startsWith(PREFIX) || v.startsWith(MULTI_PREFIX) || v.startsWith('enc:v1:'));

async function hkdf(secret, info) {
  const base = await subtle().importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('tamamhealth/org-data-key'), info: enc.encode(info) },
    base,
    256,
  ));
}

const keys = new Map();
function orgKey(secret, keyId) {
  const id = `${secret}\u0000${keyId}`;
  if (!keys.has(id)) {
    keys.set(id, hkdf(secret, `org:${keyId}:v1`)
      .then(raw => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])));
  }
  return keys.get(id);
}

let indexKeyPromise = null;
function indexKey(secret) {
  indexKeyPromise ??= hkdf(secret, 'blind-index:v1')
    .then(raw => subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  return indexKeyPromise;
}

const aad = ids => enc.encode(ids.length === 1 ? `tamamhealth:${ids[0]}` : `tamamhealth:m:${ids.join('|')}`);

export async function encryptForOrgs(secret, plaintext, keyIds) {
  if (!plaintext || isSealed(plaintext)) return plaintext;
  const ids = keyIds.length ? keyIds : [PLATFORM_KEY_ID];
  if (ids.length === 1) {
    const iv = random(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(ids) }, await orgKey(secret, ids[0]), enc.encode(plaintext)));
    return `${PREFIX}${b64url(enc.encode(ids[0]))}:${b64(iv)}:${b64(ct)}`;
  }
  const dataKeyBytes = random(32);
  const dataKey = await subtle().importKey('raw', dataKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const wrapped = [];
  for (const id of ids) {
    const wiv = random(12);
    const wct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: wiv, additionalData: aad([id]) }, await orgKey(secret, id), dataKeyBytes));
    wrapped.push(`${b64url(wiv)}.${b64url(wct)}`);
  }
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(ids) }, dataKey, enc.encode(plaintext)));
  return `${MULTI_PREFIX}${b64url(enc.encode(JSON.stringify(ids)))}:${wrapped.join(',')}:${b64(iv)}:${b64(ct)}`;
}

/** Read an envelope back. Plaintext passes through; the retired `enc:v1:` form cannot be opened here. */
export async function openValue(secret, value) {
  if (typeof value !== 'string' || !isSealed(value)) return value;
  const fromB64 = text => new Uint8Array(Buffer.from(text, 'base64'));
  const fromB64Url = text => new Uint8Array(Buffer.from(text, 'base64url'));
  if (value.startsWith(PREFIX)) {
    const [org, iv, ct] = value.slice(PREFIX.length).split(':');
    const keyId = Buffer.from(org, 'base64url').toString('utf8');
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: aad([keyId]) }, await orgKey(secret, keyId), fromB64(ct));
    return new TextDecoder().decode(plain);
  }
  if (!value.startsWith(MULTI_PREFIX)) throw new Error('Retired server-only envelope.');
  const [orgs, wrappedPart, iv, ct] = value.slice(MULTI_PREFIX.length).split(':');
  const ids = JSON.parse(Buffer.from(orgs, 'base64url').toString('utf8'));
  const [wiv, wct] = wrappedPart.split(',')[0].split('.');
  const raw = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64Url(wiv), additionalData: aad([ids[0]]) }, await orgKey(secret, ids[0]), fromB64Url(wct));
  const dataKey = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: aad(ids) }, dataKey, fromB64(ct));
  return new TextDecoder().decode(plain);
}

export async function blindIndex(secret, value) {
  const normalised = value.normalize('NFKC').toUpperCase().replace(/[\s\-_./]/g, '');
  if (!normalised) return null;
  const mac = new Uint8Array(await subtle().sign('HMAC', await indexKey(secret), enc.encode(normalised)));
  return `bi1_${b64url(mac)}`;
}

/* ── catalog walk: the same pattern semantics as encrypted-db.ts ── */

function compile(pattern) {
  return pattern.split('.').map(part => (part === '**' ? '**' : part.endsWith('[]') ? { key: part.slice(0, -2), each: true } : { key: part, each: false }));
}

function deepStrings(node, path, out) {
  if (typeof node === 'string') { out.push({ path, value: node }); return; }
  if (Array.isArray(node)) { node.forEach((item, i) => deepStrings(item, [...path, i], out)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('_')) deepStrings(v, [...path, k], out);
  }
}

function walk(node, segments, i, path, out) {
  if (node === undefined || node === null) return;
  if (i === segments.length) {
    if (typeof node === 'string') out.push({ path, value: node });
    else if (Array.isArray(node)) node.forEach((item, j) => { if (typeof item === 'string') out.push({ path: [...path, j], value: item }); });
    return;
  }
  const seg = segments[i];
  if (seg === '**') { deepStrings(node, path, out); return; }
  if (typeof node !== 'object' || Array.isArray(node)) return;
  const child = node[seg.key];
  if (seg.each) {
    if (Array.isArray(child)) child.forEach((item, j) => walk(item, segments, i + 1, [...path, seg.key, j], out));
    return;
  }
  walk(child, segments, i + 1, [...path, seg.key], out);
}

function setAt(target, path, value) {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
  node[path[path.length - 1]] = value;
}

/** The document with every catalogued plaintext field sealed, and whether anything changed. */
export async function sealDocument(secret, doc) {
  const spec = doc && CATALOG.types[doc.type];
  if (!spec || doc._deleted) return { doc, changed: false };
  const out = structuredClone(doc);
  let changed = false;
  const primary = doc.orgId && String(doc.orgId).trim() ? doc.orgId : PLATFORM_KEY_ID;
  const keyIds = [primary];
  for (const field of spec.alsoFor ?? []) {
    const extra = doc[field];
    if (extra && String(extra).trim() && !keyIds.includes(extra)) keyIds.push(extra);
  }
  for (const [field, indexField] of Object.entries(spec.blindIndex ?? {})) {
    const value = doc[field];
    if (typeof value === 'string' && value.trim() && !isSealed(value)) {
      const index = await blindIndex(secret, value);
      if (index && out[indexField] !== index) { out[indexField] = index; changed = true; }
    }
  }
  const leaves = [];
  for (const pattern of spec.fields) walk(doc, compile(pattern), 0, [], leaves);
  for (const { path, value } of leaves) {
    if (!value || isSealed(value)) continue;
    setAt(out, path, await encryptForOrgs(secret, value, keyIds));
    changed = true;
  }
  return { doc: out, changed };
}

async function main() {
  const COUCH = process.env.COUCHDB_URL || 'http://localhost:5984';
  const USER = process.env.COUCHDB_ADMIN_USER;
  const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
  const SECRET = process.env.ORG_DATA_KEY_SECRET;
  const DRY_RUN = process.env.DRY_RUN !== 'false';

  if (!USER || !PASS || !SECRET) {
    console.error('COUCHDB_ADMIN_USER, COUCHDB_ADMIN_PASSWORD and ORG_DATA_KEY_SECRET are required.');
    process.exit(1);
  }
  const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  const couch = async (path, init = {}) => {
    const res = await fetch(`${COUCH}${path}`, {
      ...init,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  const dbs = (await couch('/_all_dbs')).filter(name => name.startsWith('tamamhealth_'));
  console.log(`${DRY_RUN ? '[dry run] ' : ''}${dbs.length} database(s)`);

  let total = 0;
  let refused = 0;
  for (const db of dbs) {
    const path = `/${encodeURIComponent(db)}`;
    // A record the app saves while this runs is refused as a conflict: re-read
    // its newest revision and seal that, so the count is only what landed.
    const writeWithRetry = async docs => {
      let written = 0;
      for (let attempt = 0; docs.length; attempt++) {
        const results = await couch(`${path}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs }) });
        written += results.filter(r => r.ok).length;
        const failed = results.filter(r => r.error);
        const conflicts = failed.filter(r => r.error === 'conflict').map(r => r.id);
        for (const r of failed) {
          if (r.error !== 'conflict' || attempt === 2) {
            refused += 1;
            console.warn(`    ! ${db}/${r.id}: ${r.error} ${r.reason || ''}`);
          }
        }
        if (attempt === 2 || conflicts.length === 0) break;
        const { rows } = await couch(`${path}/_all_docs?include_docs=true`, { method: 'POST', body: JSON.stringify({ keys: conflicts }) });
        docs = [];
        for (const row of rows) {
          if (!row.doc) continue;
          const { doc, changed } = await sealDocument(SECRET, row.doc);
          if (changed) docs.push(doc);
        }
      }
      return written;
    };
    let updates = 0;
    let startkey;
    // Page through, so a 50k-patient database never sits in memory at once.
    for (;;) {
      const qs = `include_docs=true&limit=500${startkey ? `&startkey=${encodeURIComponent(JSON.stringify(startkey))}&skip=1` : ''}`;
      const { rows } = await couch(`${path}/_all_docs?${qs}`);
      if (rows.length === 0) break;
      const batch = [];
      for (const row of rows) {
        if (!row.doc || row.id.startsWith('_design/')) continue;
        const { doc, changed } = await sealDocument(SECRET, row.doc);
        if (changed) batch.push(doc);
      }
      if (DRY_RUN) updates += batch.length;
      else if (batch.length) updates += await writeWithRetry(batch);
      startkey = rows[rows.length - 1].id;
      if (rows.length < 500) break;
    }
    if (updates) console.log(`  ${db}: ${updates} record(s) ${DRY_RUN ? 'hold plaintext' : 'sealed'}`);
    total += updates;
    if (!DRY_RUN && updates) await couch(`${path}/_compact`, { method: 'POST' });
  }
  console.log(DRY_RUN
    ? `${total} record(s) would be sealed. Re-run with DRY_RUN=false to apply.`
    : `${total} record(s) sealed; compaction started on every changed database.`);
  if (refused) console.log(`${refused} record(s) still refused: re-run to retry them.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
