import { evaluateVisitFinancialEvidence } from '@/modules/financial-clearance/evidence';
import type { BillingDoc } from '@/lib/db-types-billing';

const encounter = { _id: 'visit-1', patientId: 'patient-1', hospitalId: 'facility-1', orgId: 'org-1' };
const bill = (patch: Partial<BillingDoc> & { _conflicts?: string[] } = {}): BillingDoc => ({
  _id: 'bill-1', type: 'billing', patientId: 'patient-1', patientName: 'Synthetic patient',
  facilityId: 'facility-1', facilityName: 'Test facility', facilityLevel: 'hospital', orgId: 'org-1',
  encounterId: 'visit-1', encounterDate: '2026-09-10', invoiceNumber: 'INV-1',
  items: [{ id: 'line-1', category: 'consultation', description: 'Consultation', quantity: 1, unitPrice: 100, totalPrice: 100 }],
  subtotal: 100, discount: 0, taxRate: 0, taxAmount: 0, totalAmount: 100, amountPaid: 100, balanceDue: 0,
  currency: 'SSP', status: 'paid', finalizedAt: '2026-09-10T09:00:00Z', finalizedBy: 'biller-1',
  payments: [{ id: 'receipt-1', amount: 100, method: 'cash', receivedBy: 'cashier-1', receivedByName: 'Cashier', receivedAt: '2026-09-10T09:01:00Z' }],
  generatedBy: 'biller-1', generatedByName: 'Biller', state: 'Central Equatoria', createdAt: '2026-09-10T09:00:00Z', updatedAt: '2026-09-10T09:01:00Z',
  ...patch,
} as BillingDoc);
const status = (bills: BillingDoc[]) => evaluateVisitFinancialEvidence(encounter, bills).status;

describe('visit financial evidence', () => {
  it('does not interpret no invoices as financial approval', () => expect(status([])).toBe('not_reviewed'));
  it('verifies a finalized invoice against allocated receipts', () => expect(status([bill()])).toBe('payment_verified'));
  it.each(['orgId', 'facilityId', 'patientId', 'encounterId'] as const)('rejects a mismatched %s', field => {
    expect(status([bill({ [field]: 'another-record' })])).toBe('not_reviewed');
  });
  it('rejects missing organization identity', () => {
    expect(evaluateVisitFinancialEvidence({ ...encounter, orgId: undefined }, [bill()]).status).toBe('not_reviewed');
  });
  it('requires finalization even if a draft says paid', () => expect(status([bill({ finalizedAt: undefined })])).toBe('not_reviewed'));
  it('does not trust a paid label without receipts', () => expect(status([bill({ payments: [] })])).toBe('review_required'));
  it('does not count reversed receipts', () => {
    const original = bill();
    expect(status([bill({ payments: original.payments.map(p => ({ ...p, reversed: true })), amountPaid: 0, balanceDue: 100, status: 'pending' })])).toBe('awaiting_payment');
  });
  it('detects stale totals after a reversal', () => expect(status([bill({ payments: [] })])).toBe('review_required'));
  it('does not interpret claim approval as settled money', () => expect(status([bill({ status: 'insurance_approved', payments: [], amountPaid: 0, balanceDue: 100 })])).toBe('awaiting_authorization'));
  it.each(['waived', 'paid'] as const)('requires explicit evidence for zero-value %s invoices', state => {
    expect(status([bill({ status: state, totalAmount: 0, amountPaid: 0, balanceDue: 0, payments: [] })])).toBe('review_required');
  });
  it('does not use an SSP overpayment to clear USD', () => {
    const result = evaluateVisitFinancialEvidence(encounter, [bill(), bill({ _id: 'bill-2', currency: 'USD', payments: [], amountPaid: 0, balanceDue: 100, status: 'pending' })]);
    expect(result.status).toBe('awaiting_payment');
    expect(result.invoices.map(row => row.currency)).toEqual(['SSP', 'USD']);
  });
  it('requires reconciliation of conflicting documents', () => expect(status([bill({ _conflicts: ['2-other'] })])).toBe('review_required'));
  it('ignores cancelled invoices but never treats an empty set as approval', () => expect(status([bill({ status: 'cancelled' })])).toBe('not_reviewed'));
  it('rejects non-finite amounts', () => expect(status([bill({ totalAmount: NaN })])).toBe('review_required'));
  it('does not count credit as actual settlement', () => expect(status([bill({ payments: bill().payments.map(p => ({ ...p, method: 'credit' })) })])).toBe('review_required'));
  it('rejects duplicated receipt IDs', () => expect(status([bill({ payments: [...bill().payments, ...bill().payments] })])).toBe('review_required'));
});
