/**
 * Shared DB handles and referential-integrity helper for the payment-service
 * domain modules (payments, insurance, claims, charges, payment plans,
 * invoices). This module has no imports from any of those domain files —
 * kept that way so none of them need to import each other just to share a
 * DB handle or `assertRefExists`.
 */
import { getDB } from '../db';

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
