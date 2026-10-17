/**
 * Payment Service — handles collecting payments, managing insurance,
 * payment plans, refunds, invoicing, and eligibility verification.
 * All financial mutations create corresponding ledger entries.
 */
export {
  collectPayment, getPaymentsByPatient, getPaymentsByPatientUnscopedForPortal, getAllPayments, getPaymentByReference, updatePaymentStatus, PaymentOperationError, reversePayment,
} from './payments/collection';
export type { CollectPaymentInput, PaymentReversalErrorCode } from './payments/collection';
export {
  createPaymentLink, getPaymentLink, startPaymentLinkAttempt, reconcileProviderPayment,
} from './payments/payment-links';
export type { PaymentLinkDoc, CreatePaymentLinkInput, StartPaymentLinkAttemptInput, StartPaymentLinkAttemptResult, PaymentProvider, ProviderReconciliationInput, ProviderReconciliationResult } from './payments/payment-links';
export {
  createInsurancePolicy, getPatientInsurancePolicies, getPatientInsurancePoliciesUnscopedForPortal, getInsuredPatientIds, getPrimaryPolicy, updateInsurancePolicy, deactivateInsurancePolicy, checkEligibility, getLatestEligibility, estimatePatientResponsibility,
} from './payments/insurance';
export type { CreateInsurancePolicyInput, CheckEligibilityInput } from './payments/insurance';
export {
  createCharge, getChargesByEncounter, getChargesByPatient, getChargesByPatientUnscopedForPortal,
} from './payments/charges';
export type { CreateChargeInput } from './payments/charges';
export {
  submitClaim, computeAdjudicatedStatus, adjudicateClaim, appealClaim, resubmitClaim, getClaimsByPatient, getClaimsByPatientUnscopedForPortal, getAllClaims,
} from './payments/claims';
export type { SubmitClaimInput, AdjudicateClaimOptions } from './payments/claims';
export {
  createAdjustment,
} from './payments/adjustments';
export {
  issueRefund, getRefundsByPatient,
} from './payments/refunds';
export type { RefundErrorCode } from './payments/refunds';
export {
  createPaymentPlan, getPaymentPlansByPatient, getPaymentPlansByPatientUnscopedForPortal, getAllPaymentPlans, recordPlanPayment,
} from './payments/payment-plans';
export {
  generateInvoice, getInvoicesByPatient, updateInvoiceStatus,
} from './payments/invoices';
export {
  savePaymentMethod, getPatientPaymentMethods, deletePaymentMethod,
} from './payments/saved-methods';
export {
  getPatientFinancialSummary, getPatientFinancialSummaryUnscopedForPortal,
} from './payments/financial-summary';
