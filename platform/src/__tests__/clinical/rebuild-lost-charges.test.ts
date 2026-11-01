/** @jest-environment node
 *
 * scripts/rebuild-lost-charges.mjs turns work with no bill into draft bills. A
 * wrong price or a bill for cancelled work is money asked of a patient, so the
 * pricing and the refusals are pinned here. The ledger side is in
 * billing-draft-review.test.ts.
 */
import { execFile, execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

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

  test('a prescription prices across the organisation, a lab order at its facility', () => {
    const atAnother = `[{ orgId: 'o', facilityId: 'other', category: 'pharmacy', serviceCode: 'X', unitPrice: 5, isActive: true }]`;
    expect(run(`return s.priceFor(${atAnother}, { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'X', wholeOrg: true }).unitPrice`)).toBe(5);
    expect(run(`return s.priceFor(${atAnother}, { orgId: 'o', facilityId: 'h', category: 'pharmacy', serviceCode: 'X' })`)).toBeNull();
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
    [`{ ...${rx}, fulfilment: 'external' }`, 'outside pharmacy'],
    [`{ _id: 'l', type: 'lab_result', orgId: 'o', hospitalId: 'h', encounterId: 'e', orderedAt: 't', completedAt: 't' }`, 'result entered on a form'],
  ])('refuses %s', (doc, reason) => {
    expect(run(`return s.lineFor({ doc: ${doc}, name: 'x' })`)).toEqual({ skip: reason });
  });

  test('a lab order that was placed, then resulted later, still bills', () => {
    const lab = `{ _id: 'l', type: 'lab_result', orgId: 'o', hospitalId: 'h', encounterId: 'e', orderStatus: 'resulted', orderedAt: 't1', completedAt: 't2' }`;
    expect(run(`return s.lineFor({ doc: ${lab}, name: 'CBC' })`)).toMatchObject({ category: 'laboratory' });
  });

  test('medicine handed over and then stopped stays charged, as in the app', () => {
    expect(run(`return s.lineFor({ doc: { ...${rx}, status: 'discontinued', dispensedAt: 't' }, name: 'Coartem' })`)).toMatchObject({ category: 'pharmacy' });
  });

  test('a visit marked non-paying at check-in gets no draft', () => {
    expect(run(`return s.lineFor({ doc: ${rx}, name: 'Coartem', visitPayment: 'non_paying' })`)).toEqual({ skip: 'non-paying visit' });
  });

  test('an exempt patient gets no draft, which would ask for money they do not owe', () => {
    expect(run(`return s.lineFor({ doc: ${rx}, name: 'Coartem', coverageType: 'exemption' })`)).toEqual({ skip: 'exempt patient' });
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

describe('a run against CouchDB', () => {
  const seal = (doc: Record<string, unknown>) => run(`
    const { sealDocument } = await import(${JSON.stringify(path.resolve(script, '../encrypt-phi-at-rest.mjs'))});
    return (await sealDocument('test', ${JSON.stringify(doc)})).doc;
  `) as Record<string, unknown>;
  const patient = (id: string, coverageType: string) => seal({ _id: id, type: 'patient', orgId: 'o', payorInfo: { coverageType } });
  const rx = (id: string, extra: Record<string, unknown> = {}) => seal({
    _id: id, _rev: '1-a', type: 'prescription', orgId: 'o', hospitalId: 'h', patientId: 'p1', patientName: 'A', medication: 'Coartem',
    status: 'pending', quantityToDispense: 1, createdAt: '2026-10-20T09:00:00.000Z', ...extra,
  });
  const bill = (id: string, encounterId: string, items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
    seal({ _id: id, type: 'billing', orgId: 'o', encounterId, items, ...extra });
  const fee = (id: string, serviceName: string, unitPrice: number) =>
    ({ _id: id, type: 'fee_schedule', orgId: 'o', category: 'pharmacy', serviceCode: id, serviceName, unitPrice, currency: 'SSP', isActive: true });

  const databases: Record<string, Array<Record<string, unknown>>> = {
    tamamhealth_billing: [
      bill('bill-superbill', 'visit-1', [
        { category: 'pharmacy', description: 'Amoxicillin', quantity: 1 },
        { category: 'laboratory', description: 'Paracetamol', quantity: 1 },
        { category: 'pharmacy', description: 'oenc:v1:bad:bad:bad', quantity: 1 },
      ]),
      bill('bill-cancelled', 'visit-2', [{ category: 'pharmacy', description: 'Ibuprofen', quantity: 1 }], { status: 'cancelled' }),
    ],
    'tamamhealth_billing--o': [],
    tamamhealth_encounters: [{ _id: 'visit-free', type: 'clinical_encounter', visitBilling: { payment: 'non_paying' } }],
    // Listed against catalog order: the app's first pharmacy fee is 'A dispensing'.
    tamamhealth_fee_schedule: [fee('fee-z', 'Z dispensing', 900), fee('fee-a', 'A dispensing', 100)],
    tamamhealth_hospitals: [{ _id: 'h', type: 'hospital', name: 'Juba' }],
    tamamhealth_patients: [patient('p1', 'cash'), patient('p2', 'exemption')],
    tamamhealth_prescriptions: [
      rx('rx-lost'),
      rx('rx-exempt', { patientId: 'p2' }),
      rx('rx-free-visit', { encounterId: 'visit-free' }),
      rx('rx-superbilled', { medication: 'amoxicillin', encounterId: 'visit-1' }),
      rx('rx-repeat', { medication: 'Amoxicillin', encounterId: 'visit-1' }),
      rx('rx-other-category', { medication: 'Paracetamol', encounterId: 'visit-1' }),
      rx('rx-after-cancelled-bill', { medication: 'Ibuprofen', encounterId: 'visit-2' }),
      rx('rx-outside', { fulfilment: 'external' }),
      rx('rx-handed-over', { status: 'discontinued', dispensedAt: '2026-10-21T09:00:00.000Z' }),
      // Stopped on a device, and the aggregate has not caught up.
      rx('rx-stopped-on-tenant'),
    ],
    'tamamhealth_prescriptions--o': [rx('rx-lost'), rx('rx-stopped-on-tenant', { _rev: '2-b', status: 'discontinued' })],
    tamamhealth_lab_results: [],
  };

  let server: http.Server;
  let written: Array<Record<string, unknown>>;

  beforeAll(async () => {
    written = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const url = new URL(req.url || '/', 'http://couch');
        res.setHeader('content-type', 'application/json');
        if (url.pathname === '/_all_dbs') return res.end(JSON.stringify(Object.keys(databases).sort()));
        const [, db, action] = url.pathname.split('/').map(decodeURIComponent);
        if (action === '_bulk_docs') {
          const { docs } = JSON.parse(body);
          written.push(...docs.map((doc: Record<string, unknown>) => ({ ...doc, db })));
          return res.end(JSON.stringify(docs.map((doc: { _id: string }) => ({ ok: true, id: doc._id, rev: '1-a' }))));
        }
        const rows = url.searchParams.has('startkey') ? [] : databases[db].map(doc => ({ id: doc._id, doc }));
        return res.end(JSON.stringify({ rows }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(() => new Promise(resolve => server.close(resolve)));

  const execute = (env: Record<string, string>) => promisify(execFile)(process.execPath, [script], {
    env: {
      ...process.env, ORG_DATA_KEY_SECRET: 'test', COUCHDB_ADMIN_USER: 'a', COUCHDB_ADMIN_PASSWORD: 'b',
      COUCHDB_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      SINCE: '2026-10-01', UNTIL: '2026-10-31T05:12:00Z', ...env,
    },
  });

  test('previews the real gaps and names why each other order was left out', async () => {
    const { stdout } = await execute({});
    expect(stdout).toContain('5 draft bill(s) would be created');
    expect(stdout).toContain('Skipped 1: exempt patient');
    expect(stdout).toContain('Skipped 1: non-paying visit');
    expect(stdout).toContain('Skipped 1: already on a bill for that visit');
    expect(stdout).toContain('Skipped 1: outside pharmacy');
    expect(stdout).toContain('Skipped 1: discontinued');
    expect(stdout).toContain('Skipped 1: bill line could not be read');
    expect(written).toEqual([]);
  });

  test('writes each draft once, though an order sits in two databases', async () => {
    await execute({ DRY_RUN: 'false' });
    expect(written.map(doc => doc._id).sort()).toEqual([
      'bill-rebuilt-rx-after-cancelled-bill',
      'bill-rebuilt-rx-handed-over',
      'bill-rebuilt-rx-lost',
      'bill-rebuilt-rx-other-category',
      'bill-rebuilt-rx-repeat',
    ]);
  });

  test('prices the category fallback as the app does, not in storage order', () => {
    expect(written.find(doc => doc._id === 'bill-rebuilt-rx-lost')?.totalAmount).toBe(100);
  });

  test.each([
    ['no UNTIL', { UNTIL: '' }, 'Set UNTIL'],
    ['an UNTIL that is not a date', { UNTIL: '31-10-2026' }, 'Set UNTIL'],
  ])('refuses %s, which would treat bills on their way as lost', async (_name, env, message) => {
    await expect(execute(env)).rejects.toMatchObject({ stderr: expect.stringContaining(message) });
  });
});
