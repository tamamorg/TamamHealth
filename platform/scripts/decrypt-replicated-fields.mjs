#!/usr/bin/env node
/**
 * One-time migration: decrypt server-encrypted fields that replicate to devices.
 *
 * `PHI_ENCRYPTION_ENABLED=true` made the server field-encrypt message text,
 * medical-record narrative and lab results with a key only the server holds.
 * Those documents replicate to browsers, which have no key, so they could not
 * be read on any device. The services now only encrypt such fields in a
 * deployment with no browser sync (`encryptsReplicatedFields` in
 * src/lib/field-encryption.ts). This script brings documents written before
 * that change into line: it rewrites each `enc:v1:` value in the fields below
 * as the plaintext it encrypts, so devices can read them again.
 *
 * The at-rest control for a synced deployment is disk/volume encryption
 * (PHI_AT_REST_STRATEGY=disk-encryption). Run this only once that is in place.
 *
 * It touches ONLY the fields listed in FIELD_MAP, only values carrying the
 * `enc:v1:` envelope, and writes nothing if any value in a document fails to
 * decrypt (wrong key, tampered ciphertext) — that document is reported and
 * left exactly as it is.
 *
 * Usage:
 *   DRY_RUN=true  node scripts/decrypt-replicated-fields.mjs   # preview (default)
 *   DRY_RUN=false node scripts/decrypt-replicated-fields.mjs   # apply
 *
 * Env: COUCHDB_URL (default http://localhost:5984),
 *      COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD (required),
 *      PHI_ENCRYPTION_KEY (required — the key the values were encrypted with).
 */
import { createDecipheriv } from 'node:crypto';

const COUCH = (process.env.COUCHDB_URL || 'http://localhost:5984').replace(/\/+$/, '');
const USER = process.env.COUCHDB_ADMIN_USER;
const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
const DRY_RUN = process.env.DRY_RUN !== 'false';
const KEY = Buffer.from(process.env.PHI_ENCRYPTION_KEY || '', 'base64');

if (!USER || !PASS) {
  console.error('COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD are required.');
  process.exit(1);
}
if (KEY.length !== 32) {
  console.error('PHI_ENCRYPTION_KEY must be set and decode to 32 bytes — the key the fields were encrypted with.');
  process.exit(1);
}

const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const PREFIX = 'enc:v1:';

/**
 * Database (shared name; tenant databases `<name>--org-…` are matched too) →
 * the fields its service encrypts. Kept in step with ENCRYPTED_*_FIELDS in
 * message-service.ts, medical-record-service.ts and lab-service.ts.
 */
const FIELD_MAP = {
  tamamhealth_messages: { type: 'message', fields: ['subject', 'body'], nested: [['editHistory', 'body']] },
  tamamhealth_medical_records: {
    type: 'medical_record',
    fields: ['chiefComplaint', 'historyOfPresentIllness', 'familyHistory', 'treatmentPlan'],
    nested: [['addenda', 'text']],
    objects: [['followUp', 'reason']],
  },
  tamamhealth_lab_results: { type: 'lab_result', fields: ['result', 'clinicalNotes', 'orderComment'] },
};

async function couch(path, init = {}) {
  const res = await fetch(`${COUCH}${path}`, {
    ...init,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

function decrypt(value) {
  const [, , ivB64, tagB64, ctB64] = value.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed ciphertext envelope');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

const isEncrypted = value => typeof value === 'string' && value.startsWith(PREFIX);

/** A decrypted copy of `doc`, how many values changed — or throws if any fails. */
function decryptDoc(doc, spec) {
  const out = { ...doc };
  let changed = 0;
  const open = value => { changed += 1; return decrypt(value); };
  for (const field of spec.fields) {
    if (isEncrypted(out[field])) out[field] = open(out[field]);
  }
  for (const [list, field] of spec.nested || []) {
    if (!Array.isArray(out[list])) continue;
    out[list] = out[list].map(entry => (entry && isEncrypted(entry[field]) ? { ...entry, [field]: open(entry[field]) } : entry));
  }
  for (const [object, field] of spec.objects || []) {
    if (out[object] && isEncrypted(out[object][field])) out[object] = { ...out[object], [field]: open(out[object][field]) };
  }
  return { doc: out, changed };
}

function specFor(database) {
  const base = database.split('--')[0];
  return FIELD_MAP[base] || null;
}

let totalDocs = 0;
let totalValues = 0;
let failures = 0;

const databases = (await couch('/_all_dbs')).filter(name => specFor(name));
console.log(`${DRY_RUN ? 'DRY RUN — nothing will be written' : 'APPLYING'} · ${databases.length} database(s) on ${COUCH}`);

for (const database of databases) {
  const spec = specFor(database);
  const db = encodeURIComponent(database);
  const { rows } = await couch(`/${db}/_all_docs?include_docs=true`);
  const updates = [];
  let values = 0;
  for (const { doc } of rows) {
    if (!doc || doc.type !== spec.type) continue;
    try {
      const result = decryptDoc(doc, spec);
      if (result.changed > 0) { updates.push(result.doc); values += result.changed; }
    } catch (error) {
      failures += 1;
      console.error(`  ${database}/${doc._id}: left unchanged — ${error.message}`);
    }
  }
  if (updates.length === 0) { console.log(`  ${database}: nothing to decrypt`); continue; }
  console.log(`  ${database}: ${updates.length} document(s), ${values} value(s)`);
  totalDocs += updates.length;
  totalValues += values;
  if (DRY_RUN) continue;
  for (let i = 0; i < updates.length; i += 200) {
    const result = await couch(`/${db}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs: updates.slice(i, i + 200) }) });
    for (const row of result) {
      if (row.error) { failures += 1; console.error(`  ${database}/${row.id}: ${row.error} — ${row.reason}`); }
    }
  }
}

console.log(`${DRY_RUN ? 'Would decrypt' : 'Decrypted'} ${totalValues} value(s) in ${totalDocs} document(s); ${failures} left unchanged.`);
if (DRY_RUN && totalDocs > 0) console.log('Re-run with DRY_RUN=false to apply.');
process.exit(failures > 0 ? 1 : 0);
