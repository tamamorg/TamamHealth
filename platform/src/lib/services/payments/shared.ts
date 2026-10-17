/** Payment service split: shared. Re-exported through ../payment-service. */
import { getDB } from '../../db';
import type { PaymentMethodType } from '../../db-types-payments';
import type { PaymentMethod as BillingPaymentMethod } from '../../db-types-billing';

/**
 * Referential-integrity guard: throw if an id is provided but the referenced
 * document doesn't exist, so charges/payments can't be created pointing at a
 * missing encounter/invoice (which would silently break reports + audit trails).
 */
export async function assertRefExists(dbName: string, id: string | undefined, label: string): Promise<void> {
  if (!id) return;
  try {
    await getDB(dbName).get(id);
  } catch {
    throw new Error(`${label} ${id} does not exist — refusing to create an orphaned record.`);
  }
}

export const COLLECTION_STAGE_DAYS = {
  followUp: Number(process.env.COLLECTION_STAGE_FOLLOWUP_DAYS) || 30,
  warning: Number(process.env.COLLECTION_STAGE_WARNING_DAYS) || 60,
  preWriteOff: Number(process.env.COLLECTION_STAGE_PREWRITEOFF_DAYS) || 90,
};

// ═══ Database accessors ════════════════════════════════════════════
export const paymentsDB = () => getDB('tamamhealth_payments');
export const insurancePoliciesDB = () => getDB('tamamhealth_insurance_policies');
export const eligibilityChecksDB = () => getDB('tamamhealth_eligibility_checks');
export const refundsDB = () => getDB('tamamhealth_refunds');
export const savedPaymentMethodsDB = () => getDB('tamamhealth_saved_payment_methods');
export const paymentPlansDB = () => getDB('tamamhealth_payment_plans');
export const invoicesDB = () => getDB('tamamhealth_invoices');
export const claimsDB = () => getDB('tamamhealth_claims');
export const adjustmentsDB = () => getDB('tamamhealth_adjustments');
export const chargesDB = () => getDB('tamamhealth_charges');
export const billingDB = () => getDB('tamamhealth_billing');

/**
 * `collectPayment`'s tender/provider is more granular than the BillingDoc
 * `PaymentRecord.method` union (predates mobile-money providers and card).
 * Map onto the closest billing category so a settled bill's payment history
 * stays readable — the exact tender is still on the authoritative PaymentDoc
 * this collectPayment call creates.
 */
export function toBillingPaymentMethod(method: PaymentMethodType): BillingPaymentMethod {
  switch (method) {
    case 'cash': return 'cash';
    case 'bank_transfer': return 'bank_transfer';
    case 'insurance': return 'insurance';
    case 'waiver': return 'waiver';
    case 'mpesa':
    case 'mobile_money':
    case 'airtel':
    case 'mtn_momo':
    case 'm_gurush':
      return 'mobile_money';
    // No card/payment-plan category on the bill side — an electronic
    // bank-rail settlement is the closest existing bucket.
    case 'card':
    case 'payment_plan':
      return 'bank_transfer';
    default:
      return 'cash';
  }
}
