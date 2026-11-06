/**
 * A visit is one line on the billing tab. A prescription signed from the chart
 * with no visit named used to bill with no encounter, so it landed on a day
 * line beside the visit's own line (the lab test's). It now joins the open visit.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { getDB } from '@/lib/db';
import { chargeForServices } from '@/lib/services/fee-schedule-service';
import { buildAccountLines } from '@/lib/billing-account-lines';
import type { DataScope } from '@/lib/services/data-scope';

const scope = { orgId: 'org-a', hospitalId: 'h-a', role: 'org_admin' } as DataScope;
const ctx = {
  patientId: 'p1', patientName: 'Pat', facilityId: 'h-a', facilityName: 'Juba', facilityLevel: 'clinic', state: '',
  generatedBy: 'dr', generatedByName: 'Dr', orgId: 'org-a', scope,
} as never;
const sources = async () => {
  const all = async (db: string) => (await getDB(db).allDocs({ include_docs: true })).rows.map(r => r.doc as never).filter((d: { _id: string }) => !d._id.startsWith('_design'));
  return {
    entries: await all('tamamhealth_ledger'), charges: [], payments: [], refunds: [], bills: await all('tamamhealth_billing'),
  } as never;
};

beforeEach(async () => {
  await putDoc(getDB('tamamhealth_encounters'), {
    _id: 'enc-1', type: 'clinical_encounter', orgId: 'org-a', hospitalId: 'h-a', patientId: 'p1', status: 'awaiting_labs',
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
  } as never);
});
afterEach(async () => { await teardownTestDBs(); });

test('a lab bill and a drug bill with no visit named make one line', async () => {
  await chargeForServices({ ...(ctx as object), encounterId: 'enc-1' } as never, [{ category: 'laboratory', description: 'Malaria RDT', unitPrice: 500 }]);
  const drug = await chargeForServices(ctx, [{ category: 'pharmacy', description: 'Coartem', unitPrice: 300 }]);
  expect(drug?.encounterId).toBe('enc-1');
  const lines = buildAccountLines(await sources());
  expect(lines).toHaveLength(1);
  expect(lines[0].charged).toBe(800);
});

describe('old bills saved without a visit', () => {
  const charge = (id: string, at: string, amount: number, encounterId?: string) => ({
    _id: id, type: 'ledger_entry', entryType: 'charge', amount, description: id, createdAt: at,
    referenceId: id, referenceType: 'billing', encounterId, currency: 'SSP',
  });
  const build = (entries: unknown[]) =>
    buildAccountLines({ entries, charges: [], payments: [], refunds: [], bills: [] } as never);

  test('folds into the one visit charged that Juba day', () => {
    const lines = build([
      charge('c1', '2026-11-05T08:00:00Z', 500, 'enc-1'),
      charge('c2', '2026-11-05T09:00:00Z', 300),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe('visit:enc-1');
    expect(lines[0].charged).toBe(800);
  });

  test('uses the Juba day, so a 23:00 UTC charge belongs to the next day\'s visit', () => {
    const lines = build([
      charge('c1', '2026-11-06T07:00:00Z', 500, 'enc-1'),
      charge('c2', '2026-11-05T23:00:00Z', 300),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].charged).toBe(800);
  });

  test('two visits that day is ambiguous: the visit-less charge keeps its day line', () => {
    const lines = build([
      charge('c1', '2026-11-05T08:00:00Z', 500, 'enc-1'),
      charge('c2', '2026-11-05T09:00:00Z', 200, 'enc-2'),
      charge('c3', '2026-11-05T10:00:00Z', 300),
    ]);
    expect(lines.map(l => l.id).sort()).toEqual(['day:2026-11-05', 'visit:enc-1', 'visit:enc-2']);
  });

  test('a different day stays its own line', () => {
    const lines = build([
      charge('c1', '2026-11-05T08:00:00Z', 500, 'enc-1'),
      charge('c2', '2026-11-03T09:00:00Z', 300),
    ]);
    expect(lines).toHaveLength(2);
  });

  test('a payment against the folded charge lands on the visit line; balances still sum to the ledger', () => {
    const lines = build([
      charge('c1', '2026-11-05T08:00:00Z', 500, 'enc-1'),
      charge('c2', '2026-11-05T09:00:00Z', 300),
      { _id: 'p1', type: 'ledger_entry', entryType: 'payment', amount: -300, description: 'cash', createdAt: '2026-11-05T10:00:00Z', referenceId: 'c2', referenceType: 'billing', currency: 'SSP' },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].paid).toBe(300);
    expect(lines[0].balance).toBe(500);
  });
});
