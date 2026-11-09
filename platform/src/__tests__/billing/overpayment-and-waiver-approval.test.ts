/**
 * Cash handling and separation of duties: a payment never exceeds the balance
 * (cash over it is change), and a waiver or adjustment is approved by a second
 * person holding an approver role.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { collectPayment, createAdjustment, recordDebtToAccount, debtCoveringEncounter } from '@/lib/services/payment-service';
import { createLedgerEntry, getPatientBalance } from '@/lib/services/ledger-service';
import { createBill, waiveBill } from '@/lib/services/billing-service';
import { buildReceiptData, generateReceiptHTML } from '@/lib/services/receipt-service';
import type { DataScope } from '@/lib/services/data-scope';

const SCOPE: DataScope = { role: 'org_admin', orgId: 'org-a' };
const MANAGER = { approvedBy: 'mgr-1', approvedByName: 'Mary Manager', approvedByRole: 'hospital_manager', approvedAt: '2026-11-08T08:00:00.000Z' };

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

const owe = (amount: number) => createLedgerEntry({
  patientId: 'pat-1', entryType: 'charge', amount, description: 'Charge', referenceType: 'charge',
  facilityId: 'hosp-1', orgId: 'org-a', createdBy: 'cashier-1',
});

const pay = (over: Record<string, unknown> = {}) => collectPayment({
  patientId: 'pat-1', patientName: 'Test Patient', method: 'cash', amount: 70,
  processedBy: 'cashier-1', processedByName: 'Cashier', facilityId: 'hosp-1', orgId: 'org-a',
  ...over,
} as Parameters<typeof collectPayment>[0]);

describe('overpayment', () => {
  test('refuses a payment above the balance, for cash and every other method', async () => {
    await owe(70);
    await expect(pay({ amount: 70.01 })).rejects.toMatchObject({ code: 'OVERPAYMENT' });
    await expect(pay({ method: 'mpesa', amount: 100 })).rejects.toMatchObject({ code: 'OVERPAYMENT' });
    expect(await getPatientBalance('pat-1', SCOPE)).toBe(70);
  });

  test('refuses a payment from a patient who owes nothing', async () => {
    await expect(pay({ amount: 10 })).rejects.toMatchObject({ code: 'OVERPAYMENT', message: expect.stringContaining('owes nothing') });
  });

  test('accepts the exact balance and a part payment', async () => {
    await owe(70);
    expect((await pay({ amount: 20 })).balanceBefore).toBe(70);
    expect((await pay({ amount: 50 })).balanceBefore).toBe(50);
    expect(await getPatientBalance('pat-1', SCOPE)).toBe(0);
  });

  test('cash tendered above the balance records the balance and keeps the change', async () => {
    await owe(70);
    const pmt = await pay({ amount: 70, tendered: 100 });
    expect(pmt).toMatchObject({ amount: 70, tendered: 100, changeGiven: 30, balanceBefore: 70 });
    expect(await getPatientBalance('pat-1', SCOPE)).toBe(0);
    const receipt = buildReceiptData(pmt);
    expect(receipt).toMatchObject({ amount: 70, tendered: 100, changeGiven: 30 });
    const html = generateReceiptHTML(receipt);
    expect(html).toContain('Cash received');
    expect(html).toContain('Change given');
  });

  test('exact cash carries no tendered or change fields', async () => {
    await owe(70);
    const pmt = await pay({ amount: 70, tendered: 70 });
    expect(pmt.changeGiven).toBeUndefined();
    expect(pmt.tendered).toBeUndefined();
    expect(generateReceiptHTML(buildReceiptData(pmt))).not.toContain('Change given');
  });

  test('only cash can be tendered in excess; short tender is refused', async () => {
    await owe(70);
    await expect(pay({ method: 'mpesa', amount: 70, tendered: 100 })).rejects.toMatchObject({ code: 'OVERPAYMENT' });
    await expect(pay({ amount: 70, tendered: 50 })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});

describe('waiver approval', () => {
  test('a waiver payment needs an approver', async () => {
    await owe(70);
    await expect(pay({ method: 'waiver' })).rejects.toMatchObject({ code: 'APPROVER_REQUIRED' });
  });

  test('the cashier cannot approve their own waiver', async () => {
    await owe(70);
    await expect(pay({ method: 'waiver', approval: { ...MANAGER, approvedBy: 'cashier-1' } })).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
  });

  test('an approver must hold an approver role', async () => {
    await owe(70);
    await expect(pay({ method: 'waiver', approval: { ...MANAGER, approvedByRole: 'cashier' } })).rejects.toMatchObject({ code: 'APPROVER_ROLE' });
  });

  test('a second person with an approver role approves, and is recorded', async () => {
    await owe(70);
    const pmt = await pay({ method: 'waiver', approval: MANAGER });
    expect(pmt).toMatchObject({ approvedBy: 'mgr-1', approvedByName: 'Mary Manager', approvedByRole: 'hospital_manager', processedBy: 'cashier-1' });
    expect(await getPatientBalance('pat-1', SCOPE)).toBe(0);
  });

  const adjustment = (over: Record<string, unknown> = {}) => createAdjustment({
    patientId: 'pat-1', adjustmentType: 'charity', amount: 30, reason: 'cannot pay',
    createdBy: 'cashier-1', createdByName: 'Cashier',
    approvedBy: 'mgr-1', approvedByName: 'Mary Manager', approvedByRole: 'medical_superintendent',
    facilityId: 'hosp-1', orgId: 'org-a', ...over,
  } as Parameters<typeof createAdjustment>[0]);

  test('an adjustment is approved by someone else, and the doc says who', async () => {
    await owe(70);
    const doc = await adjustment();
    expect(doc).toMatchObject({ createdBy: 'cashier-1', approvedBy: 'mgr-1', approvedByRole: 'medical_superintendent' });
    expect(await getPatientBalance('pat-1', SCOPE)).toBe(40);
    await expect(adjustment({ approvedBy: 'cashier-1' })).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    await expect(adjustment({ approvedBy: '' })).rejects.toMatchObject({ code: 'APPROVER_REQUIRED' });
    await expect(adjustment({ approvedByRole: 'cashier' })).rejects.toMatchObject({ code: 'APPROVER_ROLE' });
    expect(await getPatientBalance('pat-1', SCOPE)).toBe(40);
  });

  test('waiving a bill needs a second approver too', async () => {
    const bill = await createBill({
      patientId: 'pat-1', patientName: 'Test Patient', facilityId: 'hosp-1', facilityName: 'F', facilityLevel: 'clinic',
      encounterDate: '2026-08-08',
      items: [{ id: 'li-1', category: 'consultation', description: 'Consult', quantity: 1, unitPrice: 100, totalPrice: 100 } as never],
      generatedBy: 'cashier-1', generatedByName: 'Cashier', state: 'CES', orgId: 'org-a',
    });
    await expect(waiveBill(bill._id, 'cashier-1', 'Cashier', 'hardship', { ...MANAGER, approvedBy: 'cashier-1' })).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    await expect(waiveBill(bill._id, 'cashier-1', 'Cashier', 'hardship', undefined as never)).rejects.toMatchObject({ code: 'APPROVER_REQUIRED' });
    const waived = await waiveBill(bill._id, 'cashier-1', 'Cashier', 'hardship', MANAGER);
    expect(waived).toMatchObject({ status: 'waived', waiverApprovedBy: 'mgr-1', waiverApprovedByRole: 'hospital_manager' });
  });
});

describe('debt carried at checkout', () => {
  const debt = (over: Record<string, unknown> = {}) => recordDebtToAccount({
    patientId: 'pat-1', patientName: 'Test Patient', encounterId: 'enc-1', balance: 70, reason: 'family pays Friday',
    recordedBy: 'cashier-1', recordedByName: 'Cashier', facilityId: 'hosp-1', orgId: 'org-a', ...over,
  } as Parameters<typeof recordDebtToAccount>[0]);

  test('needs a written reason, and covers the visit it names', async () => {
    await expect(debt({ reason: ' ' })).rejects.toThrow('DEBT_REASON_REQUIRED');
    expect(await debtCoveringEncounter('pat-1', 'enc-1', 70, SCOPE)).toBeNull();
    const plan = await debt();
    expect(plan).toMatchObject({ reason: 'family pays Friday', encounterIds: ['enc-1'], totalBalance: 70 });
    expect((await debtCoveringEncounter('pat-1', 'enc-1', 70, SCOPE))?._id).toBe(plan._id);
    expect(await debtCoveringEncounter('pat-1', 'enc-2', 70, SCOPE)).toBeNull();
    // More owed than was carried: the visit is blocked again.
    expect(await debtCoveringEncounter('pat-1', 'enc-1', 90, SCOPE)).toBeNull();
  });
});
