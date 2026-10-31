#!/usr/bin/env node
/**
 * Rebuild the charges that never reached the server.
 *
 * Until 2026-10-31 some roles could not push `billing` or `ledger_entry`
 * documents, so the client push filter dropped those bills without a word.
 * SEED_VERSION 80 then wiped devices it counted as clean, and a filtered bill
 * counts as clean, so `resendRecentCharges` cannot bring those back. What
 * survives is the work itself: the prescription or lab order each bill was for.
 *
 * This finds prescriptions and lab orders in a date window that no bill refers
 * to, and writes one DRAFT bill for each, priced from the organisation's fee
 * schedule the way `chargeForServices` prices them. A draft has no ledger
 * entry, so it changes no patient balance and holds nobody at the pharmacy. It
 * sits under "To review" on /billing until a cashier finalizes it, which posts
 * the charge, or deletes it. Whether the patient already paid in cash is
 * something only the facility knows, so nothing here assumes they did not.
 *
 * Not reproduced, because the server cannot see them: facility tax settings
 * (they live on the device) and insurance cover. The cashier applies those.
 *
 * Run it after every device has updated and synced, or a device still holding
 * a real bill could resend it on top of the draft. Bills have stable ids here
 * (`bill-rebuilt-<source id>`), so re-running is safe.
 *
 *   SINCE=2026-10-01 DRY_RUN=true  node scripts/rebuild-lost-charges.mjs   # preview (default)
 *   SINCE=2026-10-01 DRY_RUN=false node scripts/rebuild-lost-charges.mjs   # apply
 *
 * Env: SINCE (required), UNTIL (optional, exclusive), COUCHDB_URL (default
 *      http://localhost:5984), COUCHDB_ADMIN_USER, COUCHDB_ADMIN_PASSWORD,
 *      ORG_DATA_KEY_SECRET (prices are matched on sealed drug and test names).
 */
import { createHash } from 'node:crypto';
import { openValue, sealDocument } from './encrypt-phi-at-rest.mjs';

const money = value => Math.round(value * 100) / 100;

/** The active price for a line: exact name first, then the category's generic fee. */
export function priceFor(fees, { orgId, facilityId, category, serviceCode }) {
  const usable = fees.filter(fee => fee.isActive && fee.orgId === orgId && (!fee.facilityId || fee.facilityId === facilityId));
  return usable.find(fee => fee.serviceCode === serviceCode) || usable.find(fee => fee.category === category) || null;
}

/** A source document as one billable line, or the reason it is not one. */
export function lineFor(source) {
  const { doc, name } = source;
  const facilityId = doc.hospitalId || doc.facilityId;
  if (!facilityId) return { skip: 'no facility' };
  if (!doc.orgId) return { skip: 'no organisation' };
  if (doc.type === 'prescription') {
    if (doc.status === 'discontinued') return { skip: 'discontinued' };
    const quantity = doc.quantityToDispense > 0 ? doc.quantityToDispense : 1;
    return { facilityId, category: 'pharmacy', serviceCode: name, quantity, referenceType: 'prescription' };
  }
  // The app bills a lab test only against an encounter (place-lab-order.ts).
  if (!doc.encounterId) return { skip: 'lab order with no visit' };
  return { facilityId, category: 'laboratory', serviceCode: name, quantity: 1, referenceType: 'lab_result' };
}

/** The draft bill for one source document. Pure, so the money can be tested. */
export function draftBill({ doc, patientName, line, fee, facilityName, patient, now }) {
  const totalPrice = money(line.quantity * fee.unitPrice);
  const day = (doc.createdAt || now).slice(0, 10);
  const tag = createHash('sha256').update(doc._id).digest('hex').slice(0, 8);
  return {
    _id: `bill-rebuilt-${doc._id}`,
    type: 'billing',
    patientId: doc.patientId,
    patientName,
    hospitalNumber: patient?.hospitalNumber,
    facilityId: line.facilityId,
    facilityName,
    facilityLevel: 'clinic',
    encounterDate: doc.createdAt || now,
    encounterId: doc.encounterId,
    items: [{
      id: `item-${tag}`,
      category: line.category,
      description: line.serviceCode,
      quantity: line.quantity,
      unitPrice: fee.unitPrice,
      totalPrice,
      referenceId: doc._id,
      referenceType: line.referenceType,
    }],
    subtotal: totalPrice,
    discount: 0,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: totalPrice,
    amountPaid: 0,
    balanceDue: totalPrice,
    currency: fee.currency,
    payments: [],
    insuranceClaimStatus: 'none',
    status: 'draft',
    generatedBy: 'charge-rebuild',
    generatedByName: 'Charge rebuild',
    invoiceNumber: `INV-${day.replace(/-/g, '')}-R${tag}`,
    state: patient?.state || '',
    county: patient?.county,
    orgId: doc.orgId,
    notes: `Rebuilt on ${now.slice(0, 10)} from ${line.referenceType} ${doc._id}. The original bill never reached the server.`,
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  const COUCH = (process.env.COUCHDB_URL || 'http://localhost:5984').replace(/\/$/, '');
  const USER = process.env.COUCHDB_ADMIN_USER;
  const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
  const SECRET = process.env.ORG_DATA_KEY_SECRET;
  const SINCE = process.env.SINCE;
  const UNTIL = process.env.UNTIL || '9999';
  const DRY_RUN = process.env.DRY_RUN !== 'false';
  if (!USER || !PASS || !SECRET) throw new Error('Set COUCHDB_ADMIN_USER, COUCHDB_ADMIN_PASSWORD and ORG_DATA_KEY_SECRET.');
  if (!/^\d{4}-\d{2}-\d{2}/.test(SINCE || '')) throw new Error('Set SINCE to a date, e.g. SINCE=2026-10-01.');

  const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  const couch = async (path, init = {}) => {
    const res = await fetch(`${COUCH}${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };
  async function* allDocs(db) {
    let startkey = null;
    for (;;) {
      const qs = `include_docs=true&limit=500${startkey ? `&startkey=${encodeURIComponent(JSON.stringify(startkey))}&skip=1` : ''}`;
      const page = await couch(`/${encodeURIComponent(db)}/_all_docs?${qs}`);
      for (const row of page.rows) if (row.doc && !row.doc._id.startsWith('_design/')) yield row.doc;
      if (page.rows.length < 500) return;
      startkey = page.rows[page.rows.length - 1].id;
    }
  }

  const dbs = (await couch('/_all_dbs')).filter(name => name.startsWith('tamamhealth_'));
  const inFamily = base => dbs.filter(name => name === base || name.startsWith(`${base}--`));
  const billingDbFor = (db, base) => db.replace(base, 'tamamhealth_billing');

  const billed = new Set();
  for (const db of inFamily('tamamhealth_billing')) {
    for await (const doc of allDocs(db)) {
      if (doc.type !== 'billing') continue;
      for (const item of doc.items || []) if (item.referenceId) billed.add(item.referenceId);
    }
  }
  const fees = [];
  for (const db of inFamily('tamamhealth_fee_schedule')) {
    for await (const doc of allDocs(db)) if (doc.type === 'fee_schedule') fees.push(doc);
  }
  const hospitals = new Map();
  for (const db of inFamily('tamamhealth_hospitals')) {
    for await (const doc of allDocs(db)) if (doc.type === 'hospital') hospitals.set(doc._id, doc.name);
  }
  const patients = new Map();
  for (const db of inFamily('tamamhealth_patients')) {
    for await (const doc of allDocs(db)) if (doc.type === 'patient') patients.set(doc._id, doc);
  }

  const now = new Date().toISOString();
  const totals = new Map();
  const skipped = new Map();
  const skip = reason => skipped.set(reason, (skipped.get(reason) || 0) + 1);
  const unpriced = new Set();
  const writes = new Map();

  for (const [base, type, field] of [
    ['tamamhealth_prescriptions', 'prescription', 'medication'],
    ['tamamhealth_lab_results', 'lab_result', 'testName'],
  ]) {
    for (const db of inFamily(base)) {
      for await (const doc of allDocs(db)) {
        if (doc.type !== type || billed.has(doc._id)) continue;
        const when = doc.createdAt || '';
        if (when < SINCE || when >= UNTIL) continue;
        let name;
        try {
          name = await openValue(SECRET, doc[field]);
        } catch {
          skip('could not be opened');
          continue;
        }
        const line = lineFor({ doc, name });
        if (line.skip) { skip(line.skip); continue; }
        const fee = priceFor(fees, { orgId: doc.orgId, facilityId: line.facilityId, category: line.category, serviceCode: name });
        if (!fee) { skip('no price in the fee schedule'); unpriced.add(`${line.category}: ${name}`); continue; }
        const bill = draftBill({
          doc, patientName: doc.patientName, line, fee, now,
          facilityName: hospitals.get(line.facilityId) || doc.hospitalName || '',
          patient: patients.get(doc.patientId),
        });
        const target = billingDbFor(db, base);
        if (!dbs.includes(target)) { skip('no billing database'); continue; }
        const key = `${line.facilityId} ${bill.currency}`;
        const total = totals.get(key) || { count: 0, amount: 0 };
        totals.set(key, { count: total.count + 1, amount: money(total.amount + bill.totalAmount) });
        if (!writes.has(target)) writes.set(target, []);
        writes.get(target).push((await sealDocument(SECRET, bill)).doc);
      }
    }
  }

  let written = 0;
  for (const [db, docs] of writes) {
    if (DRY_RUN) continue;
    for (let i = 0; i < docs.length; i += 200) {
      const result = await couch(`/${encodeURIComponent(db)}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs: docs.slice(i, i + 200) }) });
      written += result.filter(row => row.ok).length;
      const refused = result.filter(row => row.error && row.error !== 'conflict');
      if (refused.length) console.log(`  ${db}: ${refused.length} write(s) refused: ${refused[0].reason || refused[0].error}`);
    }
  }

  for (const [key, { count, amount }] of [...totals].sort()) console.log(`${key}: ${count} bill(s), ${amount}`);
  for (const [reason, count] of skipped) console.log(`Skipped ${count}: ${reason}`);
  for (const name of [...unpriced].sort().slice(0, 50)) console.log(`  unpriced ${name}`);
  console.log(DRY_RUN
    ? `Dry run: nothing was written. ${[...writes.values()].flat().length} draft bill(s) would be created. Set DRY_RUN=false to apply.`
    : `${written} draft bill(s) written. Cashiers will find them under "To review" on /billing.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
