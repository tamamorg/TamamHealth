import type { ChargeCategory } from '@/lib/db-types-billing';
import { SPECIALTY_BILLING_CATALOG } from '@/lib/db-types-billing';
import { CATEGORY_LABELS } from '@/components/billing/billing-utils';

describe('specialty billing categories', () => {
  it.each<ChargeCategory>([
    'admission_deposit', 'dental', 'dialysis', 'optical', 'cardiac_diagnostics',
    'mental_health', 'theatre', 'rehabilitation',
  ])('has a display label for %s', category => {
    expect(CATEGORY_LABELS[category]).toBeTruthy();
  });

  it('defines billing units without inventing prices', () => {
    expect(SPECIALTY_BILLING_CATALOG.every(item => item.billingUnit)).toBe(true);
    expect(SPECIALTY_BILLING_CATALOG.some(item => 'unitPrice' in item)).toBe(false);
  });
});
