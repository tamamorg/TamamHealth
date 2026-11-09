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
  patientId: 'pat-1', entryType: 'charge', amount, description: 'Charge', referenceType: 'charge',
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
