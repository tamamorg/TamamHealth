/**
 * Closing a visit with a balance: refused unless the balance is cleared,
 * waived (the waiver clears it) or the cashier carries it as a debt with a
 * written reason. No clinician override clears a balance; only a walk-out is
 * recorded regardless.
 */
jest.mock('uuid', () => ({ v4: () => `${Math.random().toString(36).slice(2)}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';
import { assertDischargeAllowed } from '@/modules/post-consult/services/discharge-service';
import { createLedgerEntry } from '@/lib/services/ledger-service';
import { recordDebtToAccount, collectPayment } from '@/lib/services/payment-service';
import { createBill } from '@/lib/services/billing-service';
import { getDB } from '@/lib/db';
import type { EncounterDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

const SCOPE: DataScope = { role: 'org_admin', orgId: 'org-a' };

afterEach(async () => { await teardownTestDBs(); });

const encounter = (): EncounterDoc => ({
  _id: 'enc-1', type: 'clinical_encounter', patientId: 'pat-1', patientName: 'Test Patient',
  clinicianId: '', clinicianName: '', hospitalId: 'hosp-1', orgId: 'org-a', status: 'in_facility_checkout',
  stageKey: 'facility_checkout', snapshot: {}, labOrderIds: [],
  startedAt: '2026-11-08T08:00:00.000Z', createdAt: '2026-11-08T08:00:00.000Z', updatedAt: '2026-11-08T08:00:00.000Z',
} as unknown as EncounterDoc);

const owe = (amount: number) => createLedgerEntry({
  patientId: 'pat-1', encounterId: 'enc-1', entryType: 'charge', amount, description: 'Charge', referenceType: 'charge',
  facilityId: 'hosp-1', orgId: 'org-a', createdBy: 'cashier-1',
});

const paymentItem = async () =>
  (await evaluateCheckoutGate('pat-1', encounter(), SCOPE)).conditions.find(c => c.key === 'payment_status_determined')!;

describe('payment_status_determined', () => {
  test('is met when nothing is owed', async () => {
    expect((await paymentItem()).satisfied).toBe(true);
  });

  test('blocks while a balance is owed, and says what to do next', async () => {
    await owe(70);
    const item = await paymentItem();
    expect(item).toMatchObject({ satisfied: false, critical: true });
    expect(item.detail).toMatch(/Outstanding balance of 70/);
    expect(item.detail).toMatch(/Collect payment, get a waiver approved by a manager, or record it as a debt with a reason/);
  });

  test('is met once the cashier records the balance as a debt with a reason', async () => {
    await owe(70);
    await recordDebtToAccount({
      patientId: 'pat-1', patientName: 'Test Patient', encounterId: 'enc-1', balance: 70, reason: 'family pays Friday',
      recordedBy: 'cashier-1', recordedByName: 'Cashier', facilityId: 'hosp-1', orgId: 'org-a',
    });
    expect((await paymentItem()).satisfied).toBe(true);
  });

  test('is met once the balance is paid', async () => {
    await owe(70);
    await collectPayment({
      patientId: 'pat-1', patientName: 'Test Patient', method: 'cash', amount: 70,
      processedBy: 'cashier-1', processedByName: 'Cashier', facilityId: 'hosp-1', orgId: 'org-a',
    });
    expect((await paymentItem()).satisfied).toBe(true);
  });
});

describe('payment_status_determined is this visit only', () => {
  const bill = (over: Record<string, unknown> = {}) => createBill({
    patientId: 'pat-1', patientName: 'Test Patient', facilityId: 'hosp-1', facilityName: 'Hosp', facilityLevel: 'phcc',
    encounterDate: '2026-11-08', encounterId: 'enc-1', items: [{ description: 'Consult', category: 'consultation', quantity: 1, unitPrice: 100 }],
    generatedBy: 'u-1', generatedByName: 'Doc', state: 'CES', orgId: 'org-a', ...over,
  } as unknown as Parameters<typeof createBill>[0]);

  test('an old unpaid visit does not hold a later checkout', async () => {
    await bill({ encounterId: 'enc-old' });
    await bill({ encounterId: 'enc-1', items: [{ description: 'Consult', category: 'consultation', quantity: 1, unitPrice: 100 }] });
    // Pay this visit's bill in full; the old visit still owes 100.
    const { getBillsByPatient, recordPayment } = await import('@/lib/services/billing-service');
    const mine = (await getBillsByPatient('pat-1', SCOPE)).find(b => b.encounterId === 'enc-1')!;
    await recordPayment(mine._id, 100, 'cash', 'cashier-1', 'Cashier');
    expect((await paymentItem()).satisfied).toBe(true);
  });

  test('this visit unpaid still blocks, with the visit figure in the message', async () => {
    await bill({ encounterId: 'enc-old' });
    await bill({ encounterId: 'enc-1' });
    const item = await paymentItem();
    expect(item.satisfied).toBe(false);
    expect(item.detail).toMatch(/Outstanding balance of 100\b/);
  });

  test('an insured patient is not blocked by the insurer share, only by their copay', async () => {
    await bill({ insuranceProvider: 'AAR', insuranceCoveragePercent: 80 });
    const item = await paymentItem();
    expect(item.satisfied).toBe(false);
    expect(item.detail).toMatch(/Outstanding balance of 20\b/);
    const { getBillsByPatient, recordPayment } = await import('@/lib/services/billing-service');
    const mine = (await getBillsByPatient('pat-1', SCOPE))[0];
    await recordPayment(mine._id, 20, 'cash', 'cashier-1', 'Cashier');
    expect((await paymentItem()).satisfied).toBe(true);
  });

  test('a fully covered insured visit is never blocked', async () => {
    await bill({ insuranceProvider: 'AAR', insuranceCoveragePercent: 100 });
    expect((await paymentItem()).satisfied).toBe(true);
  });

  test('an exempt bill and a non-paying visit are never blocked', async () => {
    await bill({ exemptReason: 'Exempt visit: Child under five' });
    expect((await paymentItem()).satisfied).toBe(true);
  });

  test('a non-paying visit is not blocked whatever was charged to it', async () => {
    await owe(70);
    const nonPaying = { ...encounter(), visitBilling: { payment: 'non_paying', exemption: 'emergency' } } as unknown as EncounterDoc;
    const item = (await evaluateCheckoutGate('pat-1', nonPaying, SCOPE)).conditions.find(c => c.key === 'payment_status_determined')!;
    expect(item.satisfied).toBe(true);
  });
});

describe('assertDischargeAllowed with a balance', () => {
  const putEncounter = async () => { await getDB('tamamhealth_encounters').put(encounter()); };
  const cashier = { actorId: 'front-1', actorRole: 'front_desk' as const };
  const clinician = { actorId: 'doc-1', actorRole: 'doctor' as const, reason: 'Patient must go' };

  test('a clinician override cannot discharge over a balance', async () => {
    await putEncounter();
    await owe(70);
    await expect(assertDischargeAllowed('enc-1', 'discharged_with_pending_items', clinician))
      .rejects.toThrow('CHECKOUT_BLOCKED: payment_status_determined');
  });

  test('a routine discharge over a balance is refused', async () => {
    await putEncounter();
    await owe(70);
    await expect(assertDischargeAllowed('enc-1', 'discharged', cashier)).rejects.toThrow(/CHECKOUT_BLOCKED.*payment_status_determined/);
  });

  test('a walk-out is still recorded', async () => {
    await putEncounter();
    await owe(70);
    await expect(assertDischargeAllowed('enc-1', 'dismissed_without_formal_checkout', clinician)).resolves.toBeUndefined();
  });
});
