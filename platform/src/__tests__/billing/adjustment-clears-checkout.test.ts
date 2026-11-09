/**
 * A manager-approved write-off posts to the ledger, not onto the bill. The
 * checkout gate and the cashier's "what is owed" read the bills, so a waived
 * amount kept blocking checkout (and showed as still owed). The credit has to
 * come off the bills' figure, and an adjustment taken from the account page
 * (no visit named) is tied to the oldest visit still owing.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { createAdjustment } from '@/lib/services/payment-service';
import { owedByPatient } from '@/lib/services/payments/collection';
import { createBill } from '@/lib/services/billing-service';
import { encounterPatientOwed } from '@/lib/services/encounter-balance';
import type { DataScope } from '@/lib/services/data-scope';

const SCOPE: DataScope = { role: 'org_admin', orgId: 'org-a' };

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const bill = (encounterId: string, amount: number) => createBill({
  patientId: 'pat-1', patientName: 'Test Patient', facilityId: 'hosp-1', facilityName: 'F', facilityLevel: 'clinic',
  encounterId, encounterDate: '2026-08-08',
  items: [{ id: 'li-1', category: 'bed_charge', description: 'Bed', quantity: 1, unitPrice: amount, totalPrice: amount } as never],
  generatedBy: 'cashier-1', generatedByName: 'Cashier', state: 'CES', orgId: 'org-a',
} as Parameters<typeof createBill>[0]);

const writeOff = (amount: number, encounterId?: string) => createAdjustment({
  patientId: 'pat-1', encounterId, adjustmentType: 'write_off', amount, reason: 'hardship',
  createdBy: 'cashier-1', createdByName: 'Cashier',
  approvedBy: 'mgr-1', approvedByName: 'Mary Manager', approvedByRole: 'medical_superintendent',
  facilityId: 'hosp-1', orgId: 'org-a',
});

test('a write-off against the visit comes off what that visit owes', async () => {
  await bill('enc-1', 8000);
  expect(await encounterPatientOwed('pat-1', { _id: 'enc-1' }, SCOPE)).toBe(8000);
  await writeOff(3000, 'enc-1');
  expect(await encounterPatientOwed('pat-1', { _id: 'enc-1' }, SCOPE)).toBe(5000);
  await writeOff(5000, 'enc-1');
  expect(await encounterPatientOwed('pat-1', { _id: 'enc-1' }, SCOPE)).toBe(0);
});

test('a write-off from the account page is tied to the oldest visit still owing', async () => {
  await bill('enc-1', 8000);
  const doc = await writeOff(3000);
  expect(doc.encounterId).toBe('enc-1');
  expect(await encounterPatientOwed('pat-1', { _id: 'enc-1' }, SCOPE)).toBe(5000);
});

test('the cashier\'s owed figure also drops by the write-off', async () => {
  await bill('enc-1', 8000);
  await writeOff(3000, 'enc-1');
  expect(await owedByPatient({ patientId: 'pat-1', orgId: 'org-a', facilityId: 'hosp-1' })).toBe(5000);
});

test('another visit is not touched by a write-off on this one', async () => {
  await bill('enc-1', 8000);
  await bill('enc-2', 2000);
  await writeOff(3000, 'enc-1');
  expect(await encounterPatientOwed('pat-1', { _id: 'enc-2' }, SCOPE)).toBe(2000);
});
