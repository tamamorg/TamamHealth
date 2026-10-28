#!/usr/bin/env node
/**
 * One-time correction of ICD-11 codes saved from the old diagnosis list.
 *
 * Until 2026-10-28, src/lib/icd11-codes.ts filed 54 diagnoses under the wrong
 * ICD-11 code (falciparum malaria as 1A40, which is gastroenteritis; epilepsy
 * as 6A20, which is schizophrenia; …). Every record a clinician coded from that
 * list carries the wrong code, and reports, surveillance and DHIS2 read the
 * code — so an old malaria case now counts as diarrhoea.
 *
 * A code alone cannot say which list wrote it (BA00 was "ischaemic heart
 * disease" in the old list and IS essential hypertension in ICD-11, and seed
 * and hand-coded records already used it correctly). So a code is remapped
 * only when the name saved beside it is the old list's title for that code,
 * exactly — the picker saved its title verbatim. Anything else is left alone
 * and counted, for a person to review.
 *
 * Names and most codes are encrypted at rest; this opens them with the app's
 * own cipher (ORG_DATA_KEY_SECRET) and seals a replaced value for the same
 * organisations it was sealed for.
 *
 * Usage:
 *   DRY_RUN=true  node --import tsx scripts/remap-icd11-codes.mjs   # preview (default)
 *   DRY_RUN=false node --import tsx scripts/remap-icd11-codes.mjs   # apply
 *
 * Env: COUCHDB_URL (default http://localhost:5984),
 *      COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD (required),
 *      ORG_DATA_KEY_SECRET (required — the same value the app runs with).
 */

/** [old code, old list title, corrected code]. Checked against the WHO ICD-11
 *  MMS tabulation (LinearizationMiniOutput-MMS-en). */
export const OLD_ICD11_PAIRS = [
  ['1A40', 'Malaria due to Plasmodium falciparum', '1F40'],
  ['1A41', 'Malaria due to Plasmodium vivax', '1F41'],
  ['1A42', 'Malaria, unspecified', '1F4Z'],
  ['1B11', 'Tuberculosis, extrapulmonary', '1B12'],
  ['1C60', 'HIV disease', '1C62'],
  ['1E30', 'Measles', '1F03'],
  ['1D80', 'Hepatitis B', '1E51.0'],
  ['1D81', 'Hepatitis C', '1E51.1'],
  ['1A30', 'Leishmaniasis (Kala-azar)', '1F54.0'],
  ['1B90', 'Meningitis', '1D01'],
  ['1C80', 'Acute viral hepatitis', '1E50'],
  ['1A70', 'Yellow fever', '1D47'],
  ['1E50', 'Rabies', '1C82'],
  ['1A80', 'Tetanus', '1C13'],
  ['DA90', 'Diarrhoeal diseases', '1A40'],
  ['DA93', 'Dysentery', '1A02'],
  ['DA70', 'Intestinal worms (Helminthiasis)', '1F9Z'],
  ['CA20', 'Chronic obstructive pulmonary disease', 'CA22'],
  ['BA00', 'Ischaemic heart disease', 'BA6Z'],
  ['BA01', 'Cerebrovascular diseases (Stroke)', '8B20'],
  ['BA80', 'Hypertensive heart disease', 'BA01'],
  ['BA02', 'Hypertension, essential', 'BA00'],
  ['5B70', 'Malnutrition', '5B7Z'],
  ['5B71', 'Severe acute malnutrition (SAM)', '5B51'],
  ['5B72', 'Moderate acute malnutrition (MAM)', '5B51'],
  ['5A00', 'Anaemia', '3A00'],
  ['5B50', 'Vitamin A deficiency', '5B55'],
  ['JA00', 'Maternal haemorrhage', 'JA43'],
  ['JA03', 'Maternal sepsis', 'JB40.0'],
  ['JA04', 'Pre-eclampsia / Eclampsia', 'JA24'],
  ['JA06', 'Obstructed labour', 'JB06'],
  ['JA10', 'Ectopic pregnancy', 'JA01'],
  ['JA20', 'Spontaneous abortion', 'JA00.0'],
  ['KA00', 'Neonatal sepsis', 'KA60'],
  ['KA01', 'Birth asphyxia', 'KB21'],
  ['KA02', 'Neonatal prematurity', 'KA21.4'],
  ['KA03', 'Low birth weight', 'KA21'],
  ['DB90', 'Diabetes mellitus', '5A14'],
  ['DB91', 'Diabetes mellitus, type 1', '5A10'],
  ['DB92', 'Diabetes mellitus, type 2', '5A11'],
  ['ED90', 'Skin infection', '1B7Z'],
  ['9A00', 'Conjunctivitis', '9A60'],
  ['9B10', 'Trachoma', '1C23'],
  ['6A70', 'Depression', '6A7Z'],
  ['6A20', 'Epilepsy', '8A6Z'],
  ['NF00', 'Road traffic injuries', 'PA0Z'],
  ['NE00', 'Drowning', 'NF08.1'],
  ['PB00', 'Assault by sharp object', 'PE3Z'],
  ['PA00', 'Assault by firearm', 'PE20.Z'],
  ['MG30', 'Snakebite envenoming', 'PA78'],
  ['NC00', 'Burns', 'NE2Z'],
  ['2C00', 'Malignant neoplasm (Cancer)', '2D4Z'],
  ['GC00', 'Urinary tract infection', 'GC08'],
  ['GA00', 'Acute kidney injury', 'GB60'],
  ['1A60', 'Syphilis', '1A6Z'],
  ['1A61', 'Gonorrhoea', '1A7Z'],
];

/** Free-text names written beside an old-list code (the demo seed, hand-typed
 *  certificates) whose meaning is beyond doubt. Same form: [old code, name, corrected code]. */
export const OLD_FREE_TEXT_PAIRS = [
  ['1A40', 'Severe malaria', '1F40'],
  ['1A40', 'Severe malaria with cerebral involvement', '1F40'],
  ['1A40', 'Malaria (P. falciparum)', '1F40'],
  ['BA02', 'Hypertensive urgency', 'BA03'],
  ['BA01', 'Cerebrovascular accident (stroke)', '8B20'],
  ['NE00', 'Burns >30% TBSA', 'NE2Z'],
  ['NE00', 'Severe burns >30% TBSA', 'NE2Z'],
  ['JA00', 'Postpartum haemorrhage', 'JA43'],
  ['JA00', 'Maternal death due to haemorrhage', 'JA43'],
];

const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const OLD = new Map([...OLD_ICD11_PAIRS, ...OLD_FREE_TEXT_PAIRS].map(([code, title, next]) => [`${code}\u0000${norm(title)}`, next]));
/** An old title already carrying its corrected code: done on an earlier run. */
const DONE = new Set([...OLD_ICD11_PAIRS, ...OLD_FREE_TEXT_PAIRS].map(([, title, next]) => `${next}\u0000${norm(title)}`));
/** Codes that are right as they stand although the old list reused the code
 *  for something else: the saved name is what ICD-11 files there. */
const ALREADY_CORRECT = new Set([
  ['BA00', 'Essential hypertension'],
  ['BA00', 'Hypertension'],
  ['BA01', 'Hypertensive heart disease'],
  ['1A40', 'Diarrhoeal disease (gastroenteritis)'],
  ['1E50', 'Acute viral hepatitis'],
  ['1C60', 'HIV disease resulting in TB'],
  ['1C60', 'HIV disease associated with tuberculosis'],
].map(([code, name]) => `${code}\u0000${norm(name)}`));

/** Keys that hold an ICD code, and the keys that may hold its name beside it. */
const CODE_KEYS = ['icd11Code', 'icd11', 'code'];
const NAME_KEYS = ['name', 'title', 'diagnosis', 'admittingDiagnosis', 'dischargeDiagnosis'];
/** Death certificates keep each cause and its code as flat sibling fields. */
const DEATH_PAIRS = [
  ['immediateICD11', 'immediateCause'],
  ['antecedentICD11_1', 'antecedentCause1'],
  ['antecedentICD11_2', 'antecedentCause2'],
  ['underlyingICD11', 'underlyingCause'],
  ['contributingICD11', 'contributingConditions'],
];

/**
 * Correct one document in place. `open` turns a stored value into plaintext;
 * `seal(plain, stored)` stores `plain` the way `stored` was stored (sealed for
 * the same organisations, or plaintext). Returns how many codes changed and
 * how many old-list codes were left because their name did not match.
 */
export async function remapDocument(doc, { open, seal, onUnmatched }) {
  let changed = 0;
  let unmatched = 0;
  const OLD_CODES = new Set(OLD_ICD11_PAIRS.map(p => p[0]));

  const fix = async (holder, codeKey, nameKey) => {
    const storedCode = holder[codeKey];
    const storedName = holder[nameKey];
    if (typeof storedCode !== 'string' || typeof storedName !== 'string') return;
    const code = (await open(storedCode)).trim();
    if (!OLD_CODES.has(code)) return;
    const name = norm(await open(storedName));
    const next = OLD.get(`${code}\u0000${name}`);
    if (!next) {
      const key = `${code}\u0000${name}`;
      if (!DONE.has(key) && !ALREADY_CORRECT.has(key)) { unmatched += 1; onUnmatched?.(code, name, doc.type); }
      return;
    }
    holder[codeKey] = await seal(next, storedCode);
    changed += 1;
  };

  const walk = async node => {
    if (Array.isArray(node)) { for (const item of node) await walk(item); return; }
    if (!node || typeof node !== 'object') return;
    const codeKey = CODE_KEYS.find(k => typeof node[k] === 'string');
    const nameKey = NAME_KEYS.find(k => typeof node[k] === 'string');
    if (codeKey && nameKey) await fix(node, codeKey, nameKey);
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('_')) continue;
      if (value && typeof value === 'object') await walk(value);
    }
  };

  if (doc.type === 'death') {
    for (const [codeKey, nameKey] of DEATH_PAIRS) await fix(doc, codeKey, nameKey);
  }
  await walk(doc);
  return { changed, unmatched };
}

async function main() {
  const COUCH = (process.env.COUCHDB_URL || 'http://localhost:5984').replace(/\/$/, '');
  const USER = process.env.COUCHDB_ADMIN_USER;
  const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
  const DRY_RUN = process.env.DRY_RUN !== 'false';
  // LIST_UNMATCHED=true prints each (type, code, saved name) left alone, with a count.
  const listUnmatched = process.env.LIST_UNMATCHED === 'true';
  const unmatchedPairs = new Map();
  const onUnmatched = (code, name, type) => {
    const key = `${type} | ${code} | ${name}`;
    unmatchedPairs.set(key, (unmatchedPairs.get(key) || 0) + 1);
  };
  if (!USER || !PASS) throw new Error('Set COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD.');
  if (!process.env.ORG_DATA_KEY_SECRET) throw new Error('Set ORG_DATA_KEY_SECRET (the value the app runs with).');

  // tsx hands a TypeScript module over as named exports or as `default`,
  // depending on how it was compiled; take whichever carries the functions.
  const loaded = await import('../src/lib/org-data-cipher.ts');
  const cipher = loaded.decryptForOrg ? loaded : loaded.default;
  const open = value => cipher.decryptForOrg(value);
  const seal = (plain, stored) => (cipher.isOrgEncrypted(stored)
    ? cipher.encryptForOrgs(plain, cipher.envelopeOrgIds(stored))
    : plain);

  const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  const couch = async (path, init = {}) => {
    const res = await fetch(`${COUCH}${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  const dbs = (await couch('/_all_dbs')).filter(name => name.startsWith('tamamhealth_'));
  let totalChanged = 0;
  let totalDocs = 0;
  let totalUnmatched = 0;
  let unreadable = 0;
  for (const db of dbs) {
    let startkey = null;
    for (;;) {
      const qs = `include_docs=true&limit=500${startkey ? `&startkey=${encodeURIComponent(JSON.stringify(startkey))}&skip=1` : ''}`;
      const page = await couch(`/${encodeURIComponent(db)}/_all_docs?${qs}`);
      if (!page.rows.length) break;
      const updates = [];
      for (const row of page.rows) {
        const doc = row.doc;
        if (!doc || doc._id.startsWith('_design/')) continue;
        try {
          const { changed, unmatched } = await remapDocument(doc, { open, seal, onUnmatched });
          totalUnmatched += unmatched;
          if (changed) { updates.push(doc); totalChanged += changed; }
        } catch {
          unreadable += 1;
        }
      }
      totalDocs += updates.length;
      if (updates.length) {
        console.log(`${db}: ${updates.length} document(s) to correct`);
        if (!DRY_RUN) {
          const result = await couch(`/${encodeURIComponent(db)}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs: updates }) });
          const failed = result.filter(r => r.error);
          if (failed.length) console.log(`  ${failed.length} write(s) refused (conflict); re-run to retry them.`);
        }
      }
      startkey = page.rows[page.rows.length - 1].id;
      if (page.rows.length < 500) break;
    }
  }
  console.log(`${DRY_RUN ? 'Would correct' : 'Corrected'} ${totalChanged} code(s) in ${totalDocs} document(s).`);
  console.log(`${totalUnmatched} old-list code(s) left because the saved name is not the old title: review by hand.`);
  if (listUnmatched) for (const [key, n] of [...unmatchedPairs].sort()) console.log(`  ${n}× ${key}`);
  if (unreadable) console.log(`${unreadable} document(s) could not be opened with this ORG_DATA_KEY_SECRET.`);
  if (DRY_RUN) console.log('Dry run: nothing was written. Set DRY_RUN=false to apply.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
