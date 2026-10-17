/** @jest-environment node
 *
 * Organisation data keys (lib/org-data-cipher.ts).
 *
 * What has to hold:
 *   - text round-trips, and the stored form never contains the text;
 *   - encrypting is idempotent — the message integrity rule compares stored
 *     wordings exactly, so an envelope must never be re-encoded;
 *   - each organisation's key is its own: an envelope moved onto another
 *     organisation's record, or tampered with, does not open;
 *   - a key this runtime cannot get is a refusal to store, never plaintext.
 */
import {
  OrgKeyUnavailableError,
  PLATFORM_KEY_ID,
  UNREADABLE_ORG_FIELD_TEXT,
  blindIndex,
  decryptForOrg,
  deriveOrgKeyBytes,
  encryptForOrg,
  envelopeOrgId,
  envelopeOrgIds,
  isOrgEncrypted,
  orgKeyIdFor,
  readOrgField,
} from '@/lib/org-data-cipher';

test('round-trips text, and the envelope does not contain it', async () => {
  const sealed = await encryptForOrg('Give 5 mg morphine IV now', 'org-a');
  expect(isOrgEncrypted(sealed)).toBe(true);
  expect(sealed).not.toContain('morphine');
  expect(envelopeOrgId(sealed)).toBe('org-a');
  expect(await decryptForOrg(sealed)).toBe('Give 5 mg morphine IV now');
});

test('a fresh IV every time, and an existing envelope is left byte-for-byte', async () => {
  const a = await encryptForOrg('same', 'org-a');
  const b = await encryptForOrg('same', 'org-a');
  expect(a).not.toBe(b);
  expect(await encryptForOrg(a, 'org-a')).toBe(a);
  expect(await encryptForOrg('enc:v1:legacy:server:value', 'org-a')).toBe('enc:v1:legacy:server:value');
});

test('organisations do not share keys, and an envelope cannot be moved between them', async () => {
  expect(Buffer.from(await deriveOrgKeyBytes('org-a'))).not.toEqual(Buffer.from(await deriveOrgKeyBytes('org-b')));
  const sealed = await encryptForOrg('org a only', 'org-a');
  const [, , , iv, ct] = sealed.split(':');
  const moved = `oenc:v1:${Buffer.from('org-b').toString('base64url')}:${iv}:${ct}`;
  await expect(decryptForOrg(moved)).rejects.toThrow();
  expect(await readOrgField(moved)).toBe(UNREADABLE_ORG_FIELD_TEXT);
});

test('a tampered ciphertext does not open', async () => {
  const sealed = await encryptForOrg('do not alter', 'org-a');
  const parts = sealed.split(':');
  const ct = Buffer.from(parts[4], 'base64');
  ct[0] ^= 0xff;
  parts[4] = ct.toString('base64');
  await expect(decryptForOrg(parts.join(':'))).rejects.toThrow();
});

test('records with no organisation use the platform key', async () => {
  expect(orgKeyIdFor(undefined)).toBe(PLATFORM_KEY_ID);
  expect(orgKeyIdFor('  ')).toBe(PLATFORM_KEY_ID);
  const sealed = await encryptForOrg('platform note', undefined);
  expect(envelopeOrgId(sealed)).toBe(PLATFORM_KEY_ID);
});

test('the key comes from the secret: a different secret cannot read it', async () => {
  const sealed = await encryptForOrg('bound to the secret', 'org-secret-check');
  jest.resetModules();
  const saved = process.env.ORG_DATA_KEY_SECRET;
  process.env.ORG_DATA_KEY_SECRET = 'a-completely-different-secret-value-0123456789';
  try {
    const other = await import('@/lib/org-data-cipher');
    await expect(other.decryptForOrg(sealed)).rejects.toThrow();
  } finally {
    process.env.ORG_DATA_KEY_SECRET = saved;
  }
});

test('with no secret and no device key, it refuses rather than storing plaintext', async () => {
  jest.resetModules();
  const saved = process.env.ORG_DATA_KEY_SECRET;
  const savedEnv = process.env.NODE_ENV;
  const savedDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.ORG_DATA_KEY_SECRET;
  Object.assign(process.env, { NODE_ENV: 'production', NEXT_PUBLIC_DEMO_MODE: 'false' });
  try {
    const fresh = await import('@/lib/org-data-cipher');
    await expect(fresh.encryptForOrg('text', 'org-a')).rejects.toThrow(fresh.OrgKeyUnavailableError);
  } finally {
    process.env.ORG_DATA_KEY_SECRET = saved;
    Object.assign(process.env, { NODE_ENV: savedEnv });
    if (savedDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = savedDemo;
  }
  expect(OrgKeyUnavailableError).toBeDefined();
});

test('the at-rest migration script seals exactly what the app opens', async () => {
  // scripts/encrypt-phi-at-rest.mjs re-implements the derivation, both
  // envelopes, the blind index and the catalog walk for a plain-Node run
  // against CouchDB; if the two drift, migrated records become unreadable or
  // unmatchable. Run the script's own code and check its output here.
  const { execFileSync } = await import('child_process');
  const path = await import('path');
  const script = path.resolve(__dirname, '../../../scripts/encrypt-phi-at-rest.mjs');
  const secret = process.env.ORG_DATA_KEY_SECRET as string;
  const program = `
    const m = await import(${JSON.stringify('file://' + script)});
    const s = ${JSON.stringify(secret)};
    const msg = await m.sealDocument(s, {
      _id: 'm1', type: 'message', orgId: 'org-a', subject: 'Results', body: 'Pick up at noon',
      editHistory: [{ body: 'Pick up at 11', at: 'x' }],
      attachments: [{ name: 'scan.png', base64Data: 'AAAA', sizeBytes: 3 }],
    });
    const again = await m.sealDocument(s, msg.doc);
    const patient = await m.sealDocument(s, {
      _id: 'p1', type: 'patient', orgId: 'org-a', firstName: 'Achol', nationalId: 'ss-123 456',
      hospitalNumber: 'JTH-1', state: 'Central Equatoria', nokName: 'Deng',
      structuredAllergies: [{ substance: 'Penicillin', status: 'active' }],
    });
    const referral = await m.sealDocument(s, {
      _id: 'r1', type: 'referral', orgId: 'org-a', toOrgId: 'org-b', reason: 'Needs surgery', patientName: 'Achol',
    });
    process.stdout.write(JSON.stringify({ msg, againChanged: again.changed, patient: patient.doc, referral: referral.doc }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program]).toString());
  expect(out.msg.changed).toBe(true);
  expect(out.againChanged).toBe(false);
  expect(await decryptForOrg(out.msg.doc.body)).toBe('Pick up at noon');
  expect(await decryptForOrg(out.msg.doc.subject)).toBe('Results');
  expect(await decryptForOrg(out.msg.doc.editHistory[0].body)).toBe('Pick up at 11');
  expect(await decryptForOrg(out.msg.doc.attachments[0].name)).toBe('scan.png');
  expect(await decryptForOrg(out.msg.doc.attachments[0].base64Data)).toBe('AAAA');

  // Catalogued fields sealed; lookup keys and places left readable.
  expect(await decryptForOrg(out.patient.firstName)).toBe('Achol');
  expect(await decryptForOrg(out.patient.structuredAllergies[0].substance)).toBe('Penicillin');
  expect(out.patient.hospitalNumber).toBe('JTH-1');
  expect(out.patient.state).toBe('Central Equatoria');
  // The blind index matches the app's, through the normalisation.
  expect(out.patient.nationalIdIndex).toBe(await blindIndex('SS123456'));

  // A cross-organisation referral opens with either organisation's key.
  expect(envelopeOrgIds(out.referral.reason)).toEqual(['org-a', 'org-b']);
  expect(await decryptForOrg(out.referral.reason)).toBe('Needs surgery');
});
