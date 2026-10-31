/**
 * The charges clinical work raises must reach the server.
 *
 * Prescribing, ordering a lab test and admitting a patient each write a bill
 * and its ledger mirror as whoever is signed in. Those roles held neither
 * document type, so the bill saved on the device, showed on it, and was refused
 * at replication: the cashier never saw it, and the pharmacy's pay-first gate
 * passed on a balance that was never there.
 *
 * Documents come from the real billing service, so a field added to
 * cancelBill or reversePaidBillCharge fails here instead of in the field.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-ccuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { billingDB, ledgerDB } from '@/lib/db';
import { cancelBill, createBill, recordPayment, reversePaidBillCharge } from '@/lib/services/billing-service';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';

type Doc = Record<string, unknown>;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as (
  newDoc: Doc, oldDoc: Doc | null, userCtx: { name?: string; roles: string[] }, secObj?: unknown,
) => void;

const refusal = (role: string, doc: Doc, old: Doc | null) => {
  try {
    validate(doc, old, { name: 'u', roles: ['org:org-a', `role:${role}`, 'user:u-1', 'facility:h-1'] }, {});
    return null;
  } catch (error) {
    return (error as { forbidden?: string }).forbidden ?? 'thrown';
  }
};

const raiseBill = () => createBill({
  patientId: 'pat-1', patientName: 'A B', hospitalNumber: 'H-1',
  facilityId: 'h-1', facilityName: 'Hospital', facilityLevel: 'clinic',
  encounterDate: '2026-10-31T08:00:00Z', encounterId: 'enc-1',
  items: [{
    id: 'i-1', category: 'pharmacy', description: 'Amoxicillin', quantity: 1, unitPrice: 1500, totalPrice: 1500,
    referenceId: 'rx-1', referenceType: 'prescription',
  }],
  currency: 'SSP', generatedBy: 'u-1', generatedByName: 'Dr A', state: 'CES', orgId: 'org-a',
} as never);

const stored = async (id: string) => await billingDB().get(id) as unknown as Doc;
const ledgerDocs = async () => {
  const { rows } = await ledgerDB().allDocs({ include_docs: true });
  return rows.map(row => row.doc as unknown as Doc).filter(doc => doc.type === 'ledger_entry');
};

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('raising a charge', () => {
  it.each(['doctor', 'clinical_officer', 'nurse', 'lab_tech'])('%s may create the bill and its ledger entry', async role => {
    const bill = await raiseBill();
    expect(refusal(role, await stored(bill._id), null)).toBeNull();
    const ledger = await ledgerDocs();
    expect(ledger).toHaveLength(1);
    expect(refusal(role, ledger[0], null)).toBeNull();
  });

  it('stays refused for roles with no clinical work to charge for', async () => {
    const bill = await raiseBill();
    expect(refusal('front_desk', await stored(bill._id), null)).not.toBeNull();
    expect(refusal('data_entry_clerk', await stored(bill._id), null)).not.toBeNull();
  });
});

describe('the ledger entries clinical roles may post', () => {
  const entry = {
    _id: 'led-1', type: 'ledger_entry', orgId: 'org-a', facilityId: 'h-1', patientId: 'pat-1',
    entryType: 'charge', amount: 1500, referenceId: 'bill-1', referenceType: 'billing',
  };

  it.each(['payment', 'refund', 'write_off'])('a doctor may not post a %s', entryType => {
    expect(refusal('doctor', { ...entry, entryType, amount: -1500 }, null)).toMatch(/only when entryType/);
  });

  it('a doctor may not post a credit tied to no bill', () => {
    expect(refusal('doctor', { ...entry, entryType: 'adjustment', amount: -1500, referenceType: 'manual' }, null))
      .toMatch(/only when referenceType/);
  });

  it.each(['cashier', 'medical_superintendent', 'super_admin'])('%s still posts a payment', role => {
    expect(refusal(role, { ...entry, entryType: 'payment', amount: -1500 }, null)).toBeNull();
  });

  it('reception keeps the ledger entries the insurance workflow writes', () => {
    expect(refusal('front_desk', { ...entry, entryType: 'insurance_payment', amount: -500 }, null)).toBeNull();
  });
});

describe('withdrawing a charge', () => {
  it('a prescriber may cancel an unpaid bill, with its reversing ledger entry', async () => {
    const bill = await raiseBill();
    const before = await stored(bill._id);
    await cancelBill(bill._id, 'u-1', 'Dr A', 'Prescription discontinued before dispensing');
    expect(refusal('doctor', await stored(bill._id), before)).toBeNull();
    const adjustment = (await ledgerDocs()).find(doc => doc.entryType === 'adjustment')!;
    expect(refusal('doctor', adjustment, null)).toBeNull();
  });

  it('a prescriber may reverse a paid bill, leaving the payment in place', async () => {
    const bill = await raiseBill();
    await recordPayment(bill._id, 1500, 'cash' as never, 'u-2', 'Cashier');
    const before = await stored(bill._id);
    await reversePaidBillCharge(bill._id, 'u-1', 'Dr A', 'Sent to an outside pharmacy');
    const after = await stored(bill._id);
    expect(after.chargeReversedAt).toBeTruthy();
    expect(refusal('doctor', after, before)).toBeNull();
  });

  it('a prescriber may not cancel a bill with money on it', async () => {
    const bill = await raiseBill();
    await recordPayment(bill._id, 500, 'cash' as never, 'u-2', 'Cashier');
    const before = await stored(bill._id);
    expect(refusal('doctor', { ...before, status: 'cancelled', balanceDue: 0 }, before)).toMatch(/only cancel an unpaid/);
  });

  it('a prescriber may not mark a bill paid or change what it charges', async () => {
    const bill = await raiseBill();
    const before = await stored(bill._id);
    expect(refusal('doctor', { ...before, status: 'paid', balanceDue: 0 }, before)).not.toBeNull();
    expect(refusal('doctor', { ...before, balanceDue: 1 }, before)).not.toBeNull();
    expect(refusal('doctor', { ...before, totalAmount: 1 }, before)).toMatch(/may not amend totalAmount/);
  });

  it('an update that only touches sync metadata still passes', async () => {
    const bill = await raiseBill();
    const before = await stored(bill._id);
    expect(refusal('doctor', { ...before, updatedAt: '2026-10-31T09:00:00Z' }, before)).toBeNull();
  });

  it.each(['nurse', 'lab_tech', 'pharmacist'])('%s may not touch a bill once it exists', async role => {
    const bill = await raiseBill();
    const before = await stored(bill._id);
    expect(refusal(role, { ...before, status: 'cancelled', balanceDue: 0 }, before)).not.toBeNull();
  });

  it('a bill still cannot be deleted by a prescriber', async () => {
    const bill = await raiseBill();
    const before = await stored(bill._id);
    expect(refusal('doctor', { ...before, _deleted: true }, before)).not.toBeNull();
  });
});
