/**
 * Billing, payment, ledger and fee-schedule reads/mutations take a REQUIRED
 * DataScope. A scope from another org, or one with no orgId, must see nothing
 * and mutate nothing; super_admin keeps the national view; the portal's own
 * UnscopedForPortal entrypoints are the only patient-id-only reads.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { getDB } from '@/lib/db';
import {
  getAllBills, getBillById, getBillsByPatient, getUnpaidBills, getBillingSummary,
  settleOpenBillsWithPayment, unsettleBillsForPayment, getBillsByPatientUnscopedForPortal,
} from '@/lib/services/billing-service';
import {
  getPatientBalance, getPatientLedger, getAllLedgerEntries, getLedgerSummary, reconcileDay,
  getPatientBalanceUnscopedForPortal, getPatientLedgerUnscopedForPortal,
} from '@/lib/services/ledger-service';
import { getFeeSchedule, getActiveFees, priceFor, chargeForServices } from '@/lib/services/fee-schedule-service';
import {
  getPaymentsByPatient, getAllPayments, getPatientInsurancePolicies, getInsuredPatientIds,
  getLatestEligibility, getChargesByPatient, getAllClaims, getRefundsByPatient,
  getPaymentPlansByPatient, getAllPaymentPlans, getInvoicesByPatient, getPatientPaymentMethods,
  getPatientFinancialSummary, getPaymentsByPatientUnscopedForPortal,
  getPatientFinancialSummaryUnscopedForPortal, getClaimsByPatientUnscopedForPortal,
  getClaimsByPatient, getPrimaryPolicy,
} from '@/lib/services/payment-service';
import type { DataScope } from '@/lib/services/data-scope';

type Role = DataScope['role'];
const A: DataScope = { orgId: 'org-a', hospitalId: 'h-a', role: 'clinician' as Role };
const B: DataScope = { orgId: 'org-b', hospitalId: 'h-b', role: 'clinician' as Role };
const NO_ORG: DataScope = { role: 'clinician' as Role };
const SUPER: DataScope = { role: 'super_admin' as Role };

afterEach(async () => { await teardownTestDBs(); });

const base = { orgId: 'org-a', facilityId: 'h-a', patientId: 'p1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

describe('billing', () => {
  beforeEach(async () => {
    await putDoc(getDB('tamamhealth_billing'), {
      ...base, _id: 'bill-1', type: 'billing', status: 'pending', items: [], payments: [],
      totalAmount: 100, amountPaid: 0, balanceDue: 100, currency: 'SSP',
    } as never);
  });
  test('another org / missing org sees nothing and cannot mutate', async () => {
    expect(await getAllBills(A)).toHaveLength(1);
    for (const s of [B, NO_ORG]) {
      expect(await getAllBills(s)).toEqual([]);
      expect(await getBillById('bill-1', s)).toBeNull();
      expect(await getBillsByPatient('p1', s)).toEqual([]);
      expect(await getUnpaidBills(s)).toEqual([]);
      expect((await getBillingSummary(s)).billCount).toBe(0);
    }
    const settled = await settleOpenBillsWithPayment({
      patientId: 'p1', amount: 50, currency: 'SSP', method: 'cash', receivedBy: 'u', receivedByName: 'U',
      paymentId: 'pay-x', scope: B,
    });
    expect(settled.settledBills).toEqual([]);
    expect((await unsettleBillsForPayment('pay-x', 'p1', 'u', 'U', B)).unsettledBills).toEqual([]);
    expect((await getBillById('bill-1', A))?.amountPaid).toBe(0);
  });
  test('super_admin national view; portal entrypoint reads by patient id', async () => {
    expect(await getAllBills(SUPER)).toHaveLength(1);
    expect(await getBillsByPatientUnscopedForPortal('p1')).toHaveLength(1);
  });
});

describe('ledger', () => {
  beforeEach(async () => {
    await putDoc(getDB('tamamhealth_ledger'), {
      ...base, _id: 'led-1', type: 'ledger_entry', entryType: 'charge', amount: 70, runningBalance: 70, description: 'x', currency: 'SSP',
    } as never);
  });
  test('another org / missing org sees nothing', async () => {
    expect(await getPatientBalance('p1', A)).toBe(70);
    for (const s of [B, NO_ORG]) {
      expect(await getPatientBalance('p1', s)).toBe(0);
      expect(await getPatientLedger('p1', undefined, s)).toEqual([]);
      expect(await getAllLedgerEntries(s)).toEqual([]);
      expect((await getLedgerSummary(s)).totalCharged).toBe(0);
      expect((await reconcileDay('2026-01-01', s)).entries).toBe(0);
    }
  });
  test('portal entrypoints read the patient\'s own ledger', async () => {
    expect(await getPatientBalanceUnscopedForPortal('p1')).toBe(70);
    expect(await getPatientLedgerUnscopedForPortal('p1', 5)).toHaveLength(1);
  });
});

describe('fee schedule', () => {
  beforeEach(async () => {
    await putDoc(getDB('tamamhealth_fee_schedule'), {
      ...base, _id: 'fee-1', type: 'fee_schedule', category: 'consultation', serviceCode: 'C', serviceName: 'Consult',
      unitPrice: 10, currency: 'SSP', isActive: true,
    } as never);
  });
  test('another org / missing org sees nothing; charging with it creates no bill', async () => {
    expect(await getFeeSchedule(A)).toHaveLength(1);
    for (const s of [B, NO_ORG]) {
      expect(await getFeeSchedule(s)).toEqual([]);
      expect(await getActiveFees(s)).toEqual([]);
      expect(await priceFor('consultation', s)).toBeNull();
    }
    const bill = await chargeForServices({
      patientId: 'p1', patientName: 'P', facilityId: 'h-b', facilityName: 'HB', facilityLevel: 'clinic', state: 's',
      orgId: 'org-b', generatedBy: 'u', generatedByName: 'U', scope: B,
    }, [{ category: 'consultation' }]);
    expect(bill).toBeNull();
  });
});

describe('payments', () => {
  beforeEach(async () => {
    const put = (db: string, doc: Record<string, unknown>) => putDoc(getDB(db), { ...base, ...doc } as never);
    await put('tamamhealth_payments', { _id: 'pay-1', type: 'payment', processedAt: '2026-01-01', amount: 5 });
    await put('tamamhealth_insurance_policies', { _id: 'pol-1', type: 'insurance_policy', isActive: true, isPrimary: true, payerName: 'X' });
    await put('tamamhealth_charges', { _id: 'chg-1', type: 'charge' });
    await put('tamamhealth_claims', { _id: 'clm-1', type: 'claim' });
    await put('tamamhealth_refunds', { _id: 'ref-1', type: 'refund' });
    await put('tamamhealth_payment_plans', { _id: 'plan-1', type: 'payment_plan', status: 'active', remainingBalance: 1 });
    await put('tamamhealth_invoices', { _id: 'inv-1', type: 'invoice', status: 'sent', dueDate: '2999-01-01', totalDue: 1 });
    await put('tamamhealth_saved_payment_methods', { _id: 'pm-1', type: 'saved_payment_method' });
  });
  test('another org / missing org sees nothing', async () => {
    expect(await getPaymentsByPatient('p1', A)).toHaveLength(1);
    expect(await getAllPayments(A)).toHaveLength(1);
    for (const s of [B, NO_ORG]) {
      expect(await getPaymentsByPatient('p1', s)).toEqual([]);
      expect(await getAllPayments(s)).toEqual([]);
      expect(await getPatientInsurancePolicies('p1', s)).toEqual([]);
      expect((await getInsuredPatientIds(s)).size).toBe(0);
      expect(await getLatestEligibility('p1', s)).toBeNull();
      expect(await getChargesByPatient('p1', s)).toEqual([]);
      expect(await getAllClaims(s)).toEqual([]);
      expect(await getClaimsByPatient('p1', s)).toEqual([]);
      expect(await getRefundsByPatient('p1', s)).toEqual([]);
      expect(await getPaymentPlansByPatient('p1', s)).toEqual([]);
      expect(await getAllPaymentPlans(s)).toEqual([]);
      expect(await getInvoicesByPatient('p1', s)).toEqual([]);
      expect(await getPatientPaymentMethods('p1', s)).toEqual([]);
      expect(await getPrimaryPolicy('p1', s)).toBeNull();
      const summary = await getPatientFinancialSummary('p1', s);
      expect(summary.totalBalance).toBe(0);
      expect(summary.activePlanBalance).toBe(0);
    }
  });
  test('portal entrypoints are the only patient-id-only reads', async () => {
    expect(await getPaymentsByPatientUnscopedForPortal('p1')).toHaveLength(1);
    expect(await getClaimsByPatientUnscopedForPortal('p1')).toHaveLength(1);
    expect((await getPatientFinancialSummaryUnscopedForPortal('p1')).patientId).toBe('p1');
  });
});
