/** @jest-environment node
 *
 * scripts/rebuild-lost-charges.mjs turns work with no bill into draft bills. A
 * wrong price or a bill for cancelled work is money asked of a patient, so the
 * pricing and the refusals are pinned here. The ledger side is in
 * billing-draft-review.test.ts.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const script = path.resolve(__dirname, '../../../scripts/rebuild-lost-charges.mjs');

function run(body: string): unknown {
  const source = `
    process.env.ORG_DATA_KEY_SECRET = 'test';
    import(${JSON.stringify(script)}).then(async s => {
      const result = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(result));
    });`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));
}

const fees = `[
  { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'Dispensing', unitPrice: 100, currency: 'SSP', isActive: true },
  { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'Coartem', unitPrice: 250.5, currency: 'SSP', isActive: true },
  { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'Old', unitPrice: 9, currency: 'SSP', isActive: false },
  { orgId: 'other', facilityId: 'h', category: 'laboratory', serviceCode: 'CBC', unitPrice: 9, currency: 'SSP', isActive: true },
]`;

describe('pricing', () => {
  test('uses the exact product, then the category fee, like chargeForServices', () => {
    expect(run(`return s.priceFor(${fees}, { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'Coartem' }).unitPrice`)).toBe(250.5);
    expect(run(`return s.priceFor(${fees}, { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'Unknown' }).unitPrice`)).toBe(100);
  });

  test('never prices from an inactive fee or another organisation', () => {
    expect(run(`return s.priceFor(${fees}, { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'Old' }).unitPrice`)).toBe(100);
    expect(run(`return s.priceFor(${fees}, { orgId: 'o', facilityId: 'h', category: 'laboratory', serviceCode: 'CBC' })`)).toBeNull();
  });
});

describe('what is billable', () => {
  const rx = `{ _id: 'rx', type: 'prescription', orgId: 'o', hospitalId: 'h', status: 'dispensed', quantityToDispense: 3 }`;

  test('a prescription bills its dispensed quantity', () => {
    expect(run(`return s.lineFor({ doc: ${rx}, name: 'Coartem' })`)).toMatchObject({ facilityId: 'h', category: 'pharmacy', quantity: 3 });
  });

  test.each([
    [`{ ...${rx}, status: 'discontinued' }`, 'discontinued'],
    [`{ ...${rx}, hospitalId: undefined }`, 'no facility'],
    [`{ ...${rx}, orgId: undefined }`, 'no organisation'],
    [`{ _id: 'l', type: 'lab_result', orgId: 'o', hospitalId: 'h' }`, 'lab order with no visit'],
  ])('refuses %s', (doc, reason) => {
    expect(run(`return s.lineFor({ doc: ${doc}, name: 'x' })`)).toEqual({ skip: reason });
  });
});

describe('the draft', () => {
  const bill = run(`return s.draftBill({
    doc: { _id: 'rx-1', type: 'prescription', patientId: 'p', orgId: 'o', encounterId: 'e', createdAt: '2026-10-20T09:00:00.000Z' },
    patientName: 'sealed', facilityName: 'Juba', now: '2026-10-31T09:00:00.000Z',
    line: { facilityId: 'h', category: 'pharmacy', serviceCode: 'Coartem', quantity: 3, referenceType: 'prescription' },
    fee: { unitPrice: 250.5, currency: 'SSP' },
  })`) as Record<string, unknown>;

  test('is a draft owing its full amount, with nothing paid', () => {
    expect(bill).toMatchObject({ status: 'draft', totalAmount: 751.5, balanceDue: 751.5, amountPaid: 0 });
    expect(bill.finalizedAt).toBeUndefined();
  });

  test('has a stable id, so a re-run cannot bill twice', () => {
    expect(bill._id).toBe('bill-rebuilt-rx-1');
  });

  test('points back at the work it bills, dated when the work was done', () => {
    expect((bill.items as Array<Record<string, unknown>>)[0]).toMatchObject({ referenceId: 'rx-1', referenceType: 'prescription' });
    expect(bill.encounterDate).toBe('2026-10-20T09:00:00.000Z');
    expect(bill.invoiceNumber).toMatch(/^INV-20261020-R[0-9a-f]{8}$/);
  });
});
