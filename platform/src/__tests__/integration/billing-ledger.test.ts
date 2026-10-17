 
/**
 * Integration — the append-only ledger and its balance derivation
 * (src/lib/services/ledger-service.ts).
 *
 * The ledger is the money source of truth. Balances are DERIVED by summing
 * entry amounts, never trusted from a stored `runningBalance` snapshot (that
 * field is not authoritative after sync). These tests pin that behaviour and
 * the charge → payment → zero-balance flow.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(12, '0')}` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createLedgerEntry, getPatientBalance, getPatientLedger } from '@/lib/services/ledger-service';
import type { DataScope as __DS } from '@/lib/services/data-scope';
// Legacy fixtures carry no org; super_admin keeps the national view that filterByScope grants.
const SUPER: __DS = { role: 'super_admin' };

const P = 'pat-ledger-1';
const base = { patientId: P, facilityId: 'hosp-001', orgId: 'org-moh-ss', createdBy: 'u' };

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('ledger: balance is derived by summing entries', () => {
  test('a charge raises the balance; a payment clears it to zero', async () => {
    await createLedgerEntry({ ...base, entryType: 'charge', amount: 70, description: 'OPD + lab' } as Parameters<typeof createLedgerEntry>[0]);
    expect(await getPatientBalance(P, SUPER)).toBe(70);

    await createLedgerEntry({ ...base, entryType: 'payment', amount: -70, description: 'cash', method: 'cash' } as Parameters<typeof createLedgerEntry>[0]);
    expect(await getPatientBalance(P, SUPER)).toBe(0);
  });

  test('balance is the sum of amounts even when timestamps tie', async () => {
    // A charge and an insurance credit posted in the same millisecond must net
    // correctly — the reason getPatientBalance sums amounts instead of reading
    // the latest stored runningBalance.
    await createLedgerEntry({ ...base, entryType: 'charge', amount: 100, description: 'procedure' } as Parameters<typeof createLedgerEntry>[0]);
    await createLedgerEntry({ ...base, entryType: 'adjustment', amount: -40, description: 'NGO subsidy' } as Parameters<typeof createLedgerEntry>[0]);
    expect(await getPatientBalance(P, SUPER)).toBe(60);
  });

  test('entries accumulate as an append-only history', async () => {
    await createLedgerEntry({ ...base, entryType: 'charge', amount: 30, description: 'a' } as Parameters<typeof createLedgerEntry>[0]);
    await createLedgerEntry({ ...base, entryType: 'charge', amount: 20, description: 'b' } as Parameters<typeof createLedgerEntry>[0]);
    await createLedgerEntry({ ...base, entryType: 'payment', amount: -50, description: 'c', method: 'cash' } as Parameters<typeof createLedgerEntry>[0]);
    const ledger = await getPatientLedger(P, undefined, SUPER);
    expect(ledger).toHaveLength(3);           // nothing overwritten
    expect(await getPatientBalance(P, SUPER)).toBe(0);
  });

  test('a fresh patient has a zero balance', async () => {
    expect(await getPatientBalance('pat-never-seen', SUPER)).toBe(0);
  });
});
