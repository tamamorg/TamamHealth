/**
 * Patient data encrypted at the database boundary (lib/encrypted-db.ts).
 *
 * What has to hold for this to sit safely under a synced, validated record:
 *   - storage (and so replication) holds ciphertext; callers read plaintext;
 *   - lookup keys and scoping fields stay readable;
 *   - an untouched field keeps its exact envelope across a save, so the sync
 *     validators do not see an amend-only role "editing" fields it may not;
 *   - a field this device could not read is never saved back as its placeholder;
 *   - a value query on an encrypted field fails loudly instead of matching nothing;
 *   - the national ID is matchable through its blind index;
 *   - a record addressed to two organisations opens for both;
 *   - switching writing off never decrypts what is already sealed.
 */
import PouchDB from 'pouchdb-browser';
import memoryAdapter from 'pouchdb-adapter-memory';
import { fieldsOutsideAmendGrant } from '@/lib/sync/write-permissions';
import { encryptDocument, runWithoutEncryption, wrapEncrypted } from '@/lib/encrypted-db';
import {
  UNREADABLE_ORG_FIELD_TEXT, blindIndex, envelopeOrgIds, encryptForOrg, isOrgEncrypted,
} from '@/lib/org-data-cipher';

 
const findPlugin = require('pouchdb-find');
PouchDB.plugin(memoryAdapter);
PouchDB.plugin(findPlugin.default || findPlugin);

let n = 0;
let raw: PouchDB.Database;
let db: PouchDB.Database;
const savedSwitch = process.env.NEXT_PUBLIC_PHI_ENCRYPTION;

beforeEach(() => {
  process.env.NEXT_PUBLIC_PHI_ENCRYPTION = 'true';
  raw = new PouchDB(`enc-test-${n++}`, { adapter: 'memory' });
  db = wrapEncrypted(raw, 'tamamhealth_test');
});
afterEach(async () => {
  await raw.destroy();
  if (savedSwitch === undefined) delete process.env.NEXT_PUBLIC_PHI_ENCRYPTION;
  else process.env.NEXT_PUBLIC_PHI_ENCRYPTION = savedSwitch;
});

const patient = {
  _id: 'pat-1', type: 'patient', orgId: 'org-a',
  firstName: 'Achol', surname: 'Deng', nationalId: 'SS-123456', phone: '+211 912 000 111',
  hospitalNumber: 'JTH-000123', state: 'Central Equatoria', registrationHospital: 'hosp-1',
  allergies: ['Penicillin'], structuredAllergies: [{ substance: 'Sulfa', reaction: 'Rash', status: 'active' }],
  estimatedAge: 34,
};

test('stores ciphertext and reads back plaintext; lookup and scoping fields stay readable', async () => {
  await db.put(patient);
  const stored = await raw.get('pat-1') as Record<string, unknown>;
  for (const field of ['firstName', 'surname', 'nationalId', 'phone']) expect(isOrgEncrypted(stored[field])).toBe(true);
  expect(isOrgEncrypted((stored.allergies as string[])[0])).toBe(true);
  expect(isOrgEncrypted((stored.structuredAllergies as Array<Record<string, string>>)[0].substance)).toBe(true);
  expect(JSON.stringify(stored)).not.toMatch(/Achol|Deng|123456|Penicillin|Sulfa/);
  expect(stored.hospitalNumber).toBe('JTH-000123');
  expect(stored.state).toBe('Central Equatoria');
  expect(stored.orgId).toBe('org-a');
  expect(stored.estimatedAge).toBe(34);

  const read = await db.get('pat-1') as typeof patient;
  expect(read.firstName).toBe('Achol');
  expect(read.structuredAllergies[0].substance).toBe('Sulfa');
  const listed = await db.allDocs({ include_docs: true });
  expect((listed.rows[0].doc as unknown as typeof patient).surname).toBe('Deng');
});

test('an untouched field keeps its exact envelope, so amend-only roles still pass the validators', async () => {
  const rx = {
    _id: 'rx-1', type: 'prescription', orgId: 'org-a', patientId: 'pat-1',
    patientName: 'Achol Deng', medication: 'Amoxicillin 500 mg', dose: '500 mg', status: 'pending',
  };
  await db.put(rx);
  const before = await raw.get('rx-1') as Record<string, unknown>;

  // A pharmacist dispenses: reads plaintext, changes only granted fields, saves.
  const current = await db.get('rx-1') as typeof rx & { _rev: string };
  await db.put({ ...current, status: 'dispensed', dispenseNote: 'Given with counselling' });
  const after = await raw.get('rx-1') as Record<string, unknown>;

  expect(after.patientName).toBe(before.patientName);
  expect(after.medication).toBe(before.medication);
  expect(isOrgEncrypted(after.dispenseNote)).toBe(true);
  expect(fieldsOutsideAmendGrant('prescription', 'pharmacist', before, after)).toEqual([]);
});

test('bulkDocs keeps untouched envelopes too', async () => {
  await db.put({ _id: 'n1', type: 'patient_note', orgId: 'org-a', patientId: 'p', body: 'first' });
  const before = await raw.get('n1') as Record<string, unknown>;
  const current = await db.get('n1') as Record<string, unknown>;
  await db.bulkDocs([{ ...current, authorName: 'Nurse Ben' }]);
  expect((await raw.get('n1') as Record<string, unknown>).body).toBe(before.body);
});

test('a field this device could not read is never written back as its placeholder', async () => {
  await db.put({ _id: 'n2', type: 'patient_note', orgId: 'org-a', patientId: 'p', body: 'the only copy' });
  const sealed = (await raw.get('n2') as Record<string, unknown>).body;
  const current = await db.get('n2') as Record<string, unknown>;
  await db.put({ ...current, body: UNREADABLE_ORG_FIELD_TEXT, authorName: 'x' });
  expect((await raw.get('n2') as Record<string, unknown>).body).toBe(sealed);
  // And a brand-new record cannot be created from a placeholder at all.
  await expect(db.put({ _id: 'n3', type: 'patient_note', orgId: 'org-a', body: UNREADABLE_ORG_FIELD_TEXT }))
    .rejects.toThrow(/cannot be read on this device/);
});

test('a value query on an encrypted field is refused; metadata queries still work', async () => {
  await db.put(patient);
  await expect(db.find({ selector: { type: 'patient', surname: 'Deng' } })).rejects.toThrow(/encrypted at rest/);
  await expect(db.find({ selector: { type: 'patient', $or: [{ phone: 'x' }] } })).rejects.toThrow(/encrypted at rest/);
  const hits = await db.find({ selector: { type: 'patient', hospitalNumber: 'JTH-000123' } });
  expect((hits.docs[0] as unknown as typeof patient).firstName).toBe('Achol');
});

test('the national ID is matchable through its blind index, however it was typed', async () => {
  await db.put(patient);
  const stored = await raw.get('pat-1') as Record<string, unknown>;
  expect(stored.nationalIdIndex).toBe(await blindIndex('ss 123456'));
  const hits = await db.find({ selector: { type: 'patient', nationalIdIndex: await blindIndex('ss-123-456') } });
  expect(hits.docs.map(d => d._id)).toEqual(['pat-1']);
});

test('a cross-organisation referral is sealed for both organisations', async () => {
  await db.put({ _id: 'ref-1', type: 'referral', orgId: 'org-a', toOrgId: 'org-b', patientName: 'Achol', reason: 'Surgery' });
  const stored = await raw.get('ref-1') as Record<string, unknown>;
  expect(envelopeOrgIds(stored.reason as string)).toEqual(['org-a', 'org-b']);
  expect((await db.get('ref-1') as Record<string, unknown>).reason).toBe('Surgery');
});

test('a record re-homed to another organisation is re-sealed for it on the next save', async () => {
  await db.put(patient);
  const current = await db.get('pat-1') as Record<string, unknown>;
  await db.put({ ...current, orgId: 'org-b' });
  const stored = await raw.get('pat-1') as Record<string, unknown>;
  expect(envelopeOrgIds(stored.firstName as string)).toEqual(['org-b']);
});

test('with writing switched off, a sealed field stays sealed; new plaintext stays plaintext', async () => {
  await db.put(patient);
  const sealedName = (await raw.get('pat-1') as Record<string, unknown>).firstName;
  process.env.NEXT_PUBLIC_PHI_ENCRYPTION = 'false';
  const current = await db.get('pat-1') as Record<string, unknown>;
  await db.put({ ...current, assignmentNote: 'see tomorrow' });
  const stored = await raw.get('pat-1') as Record<string, unknown>;
  expect(stored.firstName).toBe(sealedName);
  expect(stored.assignmentNote).toBe('see tomorrow');
});

test('the seed bypass writes as given, and plaintext still reads', async () => {
  await runWithoutEncryption(() => db.put({ ...patient, _id: 'seed-1' }));
  expect((await raw.get('seed-1') as Record<string, unknown>).firstName).toBe('Achol');
  expect((await db.get('seed-1') as Record<string, unknown>).firstName).toBe('Achol');
});

test('types outside the catalog, deletions and replication writes pass through untouched', async () => {
  await db.put({ _id: 'h1', type: 'hospital', name: 'Juba Teaching' });
  expect((await raw.get('h1') as Record<string, unknown>).name).toBe('Juba Teaching');
  const doc = { _id: 'x', type: 'patient_note', body: 'b' };
  expect(await encryptDocument({ ...doc, _deleted: true })).toEqual({ ...doc, _deleted: true });
  const sealed = await encryptForOrg('kept as is', 'org-a');
  await db.bulkDocs([{ _id: 'r', _rev: '1-abc', type: 'patient_note', body: sealed }] as never, { new_edits: false });
  expect((await raw.get('r') as Record<string, unknown>).body).toBe(sealed);
});
