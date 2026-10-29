#!/usr/bin/env node
/**
 * Give facility-less prescriptions back their facility.
 *
 * Until 2026-10-29 the patient chart handed its note editor a user object
 * without `hospitalId`, and the editor passed that on to the prescribe form.
 * Every prescription written from a chart note was therefore saved with no
 * `hospitalId`. `filterByScope` treats a document with no facility as
 * organisation-wide, so those prescriptions — patient, drug, prescriber — were
 * visible to every facility in the organisation, not just the one that wrote
 * them (seen live: a Malakal nurse's progress feed listing a Juba patient's
 * dispense).
 *
 * This finds prescriptions with no `hospitalId` and sets it from, in order:
 *   1. the encounter the prescription belongs to (`encounterId` → `facilityId`)
 *   2. the patient's registration facility (`registrationHospital`, then
 *      `lastVisitHospital`, then `hospitalId`)
 * and fills `hospitalName` from the facility directory when it is missing.
 * Anything it cannot place is listed and left alone.
 *
 * Facility ids are not in the PHI catalog, so no data key is needed: the
 * fields read and written here are stored in the clear.
 *
 *   DRY_RUN=true  node scripts/repair-prescription-facility.mjs   # preview (default)
 *   DRY_RUN=false node scripts/repair-prescription-facility.mjs   # apply
 *
 * Env: COUCHDB_URL (default http://localhost:5984),
 *      COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD (required).
 */

/** The facility a facility-less prescription belongs to, or null. */
export function facilityFor(rx, { encounters, patients }) {
  if (rx.encounterId && encounters.get(rx.encounterId)) return encounters.get(rx.encounterId);
  if (rx.patientId && patients.get(rx.patientId)) return patients.get(rx.patientId);
  return null;
}

async function main() {
  const COUCH = (process.env.COUCHDB_URL || 'http://localhost:5984').replace(/\/$/, '');
  const USER = process.env.COUCHDB_ADMIN_USER;
  const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
  const DRY_RUN = process.env.DRY_RUN !== 'false';
  if (!USER || !PASS) throw new Error('Set COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD.');

  const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  const couch = async (path, init = {}) => {
    const res = await fetch(`${COUCH}${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  /** Every document in every tamamhealth_* database, page by page. */
  async function* allDocs(dbs) {
    for (const db of dbs) {
      let startkey = null;
      for (;;) {
        const qs = `include_docs=true&limit=500${startkey ? `&startkey=${encodeURIComponent(JSON.stringify(startkey))}&skip=1` : ''}`;
        const page = await couch(`/${encodeURIComponent(db)}/_all_docs?${qs}`);
        if (!page.rows.length) break;
        for (const row of page.rows) {
          if (row.doc && !row.doc._id.startsWith('_design/')) yield { db, doc: row.doc };
        }
        startkey = page.rows[page.rows.length - 1].id;
        if (page.rows.length < 500) break;
      }
    }
  }

  const dbs = (await couch('/_all_dbs')).filter(name => name.startsWith('tamamhealth_'));

  // Pass 1: where each encounter and patient sits, and what each facility is called.
  const encounters = new Map();
  const patients = new Map();
  const facilityNames = new Map();
  for await (const { doc } of allDocs(dbs)) {
    if (doc.type === 'encounter' && doc.facilityId) encounters.set(doc._id, doc.facilityId);
    if (doc.type === 'patient') {
      const home = doc.registrationHospital || doc.lastVisitHospital || doc.hospitalId;
      if (home) patients.set(doc._id, home);
    }
    if (doc.type === 'hospital' && doc.name) facilityNames.set(doc._id, doc.name);
  }

  // Pass 2: the prescriptions with no facility.
  const updatesByDb = new Map();
  const unresolved = [];
  let found = 0;
  for await (const { db, doc } of allDocs(dbs)) {
    if (doc.type !== 'prescription' || doc.hospitalId) continue;
    found += 1;
    const facility = facilityFor(doc, { encounters, patients });
    if (!facility) { unresolved.push(`${db}/${doc._id}`); continue; }
    doc.hospitalId = facility;
    if (!doc.hospitalName && facilityNames.has(facility)) doc.hospitalName = facilityNames.get(facility);
    if (!updatesByDb.has(db)) updatesByDb.set(db, []);
    updatesByDb.get(db).push(doc);
  }

  let placed = 0;
  for (const [db, docs] of updatesByDb) {
    placed += docs.length;
    console.log(`${db}: ${docs.length} prescription(s) to give a facility`);
    if (DRY_RUN) continue;
    for (let i = 0; i < docs.length; i += 200) {
      const result = await couch(`/${encodeURIComponent(db)}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs: docs.slice(i, i + 200) }) });
      const failed = result.filter(r => r.error);
      if (failed.length) console.log(`  ${failed.length} write(s) refused (conflict); re-run to retry them.`);
    }
  }

  console.log(`${found} prescription(s) had no facility. ${DRY_RUN ? 'Would place' : 'Placed'} ${placed}.`);
  if (unresolved.length) {
    console.log(`${unresolved.length} could not be placed (no encounter or patient facility). Review by hand:`);
    for (const id of unresolved.slice(0, 50)) console.log(`  ${id}`);
    if (unresolved.length > 50) console.log(`  … and ${unresolved.length - 50} more`);
  }
  if (DRY_RUN) console.log('Dry run: nothing was written. Set DRY_RUN=false to apply.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
