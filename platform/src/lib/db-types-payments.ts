/**
 * Patient Insurance & Payments types.
 * Extends the billing module with insurance management, ledger accounting,
 * payment plans, eligibility verification, claims, and refunds.
 * Designed for offline-first operation with PouchDB.
 */
import type { BaseDoc } from './db-types';

// ═══ Enums / Union types ═══════════════════════════════════════════

export type PayerType = 'donor' | 'government' | 'nhis' | 'cbhi' | 'private' | 'employer' | 'self_pay';
export type EligibilityStatus = 'verified' | 'unverified' | 'expired' | 'denied' | 'cached';
export type EligibilitySource = 'edi271' | 'api' | 'cache' | 'manual' | 'donor_list';
export type ClaimStatus = 'draft' | 'submitted' | 'accepted' | 'denied' | 'paid' | 'appealed' | 'partial';
export type ChargeStatus = 'pending' | 'submitted' | 'approved' | 'denied' | 'appealed' | 'voided';
export type AdjustmentType = 'contractual' | 'write_off' | 'charity' | 'denial' | 'correction' | 'bad_debt';
export type PaymentStatus = 'pending' | 'posted' | 'reversed' | 'refunded' | 'failed';
export type RefundStatus = 'pending' | 'processed' | 'failed';
export type PaymentPlanStatus = 'active' | 'completed' | 'delinquent' | 'cancelled' | 'defaulted';
export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled';
export type LedgerEntryType = 'charge' | 'payment' | 'insurance_payment' | 'adjustment' | 'refund' | 'write_off';
export type PaymentMethodType = 'cash' | 'mpesa' | 'airtel' | 'mtn_momo' | 'm_gurush' | 'card' | 'bank_transfer' | 'payment_plan' | 'waiver' | 'insurance';
export type SavedPaymentMethodType = 'mpesa' | 'airtel' | 'mtn_momo' | 'm_gurush' | 'card' | 'bank';
export type CollectionStage = 'current' | '30_day' | '60_day' | '90_day' | '120_plus' | 'collections_agency' | 'written_off';

// ═══ Insurance Policy ══════════════════════════════════════════════

export interface InsurancePolicyDoc extends BaseDoc {
  type: 'insurance_policy';
  patientId: string;
  payerType: PayerType;
  payerName: string;            // e.g. "Health Pooled Fund", "AAR Insurance", "NHIF"
  payerCode?: string;           // Payer identifier for EDI
  memberId?: string;            // Member/subscriber ID
  groupNumber?: string;         // Group/employer number
  policyNumber?: string;
  subscriberName?: string;      // If patient is dependent
  subscriberRelationship?: 'self' | 'spouse' | 'child' | 'other';
  effectiveDate: string;        // YYYY-MM-DD
  terminationDate?: string;     // YYYY-MM-DD
  isPrimary: boolean;
  copayAmount?: number;         // Fixed copay per visit
  coinsurancePct?: number;      // e.g. 20 means patient pays 20%
  deductibleAmount?: number;    // Annual deductible
  deductibleRemaining?: number;
  oopMax?: number;              // Annual out-of-pocket maximum
  oopUsed?: number;
  coverageNotes?: string;
  isActive: boolean;
  // Donor-specific
  donorProgramId?: string;
  donorCoverageType?: 'full' | 'partial' | 'emergency_only';
  // Admin
  facilityId: string;
  orgId?: string;
}

// ═══ Eligibility Check ═════════════════════════════════════════════

export interface EligibilityCheckDoc extends BaseDoc {
  type: 'eligibility_check';
  policyId: string;
  patientId: string;
  checkDate: string;
  status: EligibilityStatus;
  deductibleRemaining?: number;
  copayAmount?: number;
  coinsurancePct?: number;
  oopUsed?: number;
  oopMax?: number;
  coveredServices?: string[];
  excludedServices?: string[];
  estimatedPatientResponsibility?: number;
  rawResponse?: string;         // JSON stringified EDI/API response
  source: EligibilitySource;
  expiresAt?: string;           // Cache expiry
  checkedBy: string;
  facilityId: string;
  orgId?: string;
}

// ═══ Encounter Charges ═════════════════════════════════════════════

export interface ChargeDoc extends BaseDoc {
  type: 'charge';
  encounterId: string;
  patientId: string;
  cptCode?: string;
  icdCodes?: string[];
  modifier?: string;
  description: string;
  category: string;             // consultation, laboratory, pharmacy, etc.
  units: number;
  billedAmount: number;
  allowedAmount?: number;       // Set after payer adjudication
  status: ChargeStatus;
  claimId?: string;
  denialReasonCode?: string;
  serviceDate: string;
  providerId?: string;
  providerName?: string;
  facilityId: string;
  orgId?: string;
}

// ═══ Claim (submitted to payer) ════════════════════════════════════

export interface ClaimDoc extends BaseDoc {
  type: 'claim';
  // Optional: some claims (e.g. submitted directly against a BillingDoc that
  // has no linked clinical encounter) have no real encounter to reference.
  // Referential integrity for encounterId is NOT enforced by submitClaim.
  encounterId?: string;
  // Links back to the BillingDoc this claim was raised against, when the
  // claim was created from the billing/claims UI rather than seeded directly.
  billingId?: string;
  patientId: string;
  patientName: string;
  policyId: string;
  payerName: string;
  payerType: PayerType;
  claimNumber?: string;         // Payer-assigned claim ID
  chargeIds: string[];          // Links to ChargeDoc IDs
  totalBilled: number;
  totalAllowed?: number;        // Set when ERA received
  totalApproved?: number;
  totalDenied?: number;
  totalWriteOff?: number;
  patientResponsibility?: number;
  submittedDate?: string;
  adjudicatedDate?: string;
  status: ClaimStatus;
  denialReasons?: string[];
  remarkCodes?: string[];
  eraReference?: string;        // ERA/835 document reference
  // Adjudication accountability/notes — who decided and any free-text context
  // (distinct from denialReasons, which are payer-facing reason codes/text).
  adjudicatedBy?: string;
  adjudicationNotes?: string;
  // Appeal / resubmission lifecycle (denied -> appealed -> resubmitted).
  appealNote?: string;
  appealedAt?: string;
  appealedBy?: string;
  resubmissionCount?: number;
  lastResubmittedAt?: string;
  lastResubmittedBy?: string;
  // Donor claim fields
  donorReportingPeriod?: string;
  // Admin
  submittedBy?: string;
  facilityId: string;
  facilityName: string;
  orgId?: string;
}

// ═══ Adjustment ════════════════════════════════════════════════════

export interface AdjustmentDoc extends BaseDoc {
  type: 'adjustment';
  encounterId?: string;
  patientId: string;
  chargeId?: string;
  claimId?: string;
  adjustmentType: AdjustmentType;
  amount: number;               // Always positive; type determines direction
  reason: string;
  reasonCode?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedDate?: string;
  facilityId: string;
  orgId?: string;
}

// ═══ Payment ═══════════════════════════════════════════════════════

export interface PaymentDoc extends BaseDoc {
  type: 'payment';
  patientId: string;
  patientName: string;
  encounterId?: string;         // Nullable for multi-encounter payments
  invoiceId?: string;
  paymentPlanId?: string;       // If part of a plan installment
  method: PaymentMethodType;
  amount: number;
  currency: string;
  reference?: string;           // Receipt #, M-Pesa txn ID, card auth code
  /** External gateway that owns the callback for this payment. */
  provider?: 'flutterwave' | 'airtel' | 'mpesa';
  /** Gateway-issued immutable transaction/receipt id, used for replay detection. */
  providerReference?: string;
  /** Pay-by-link source, used to consume or release the link atomically. */
  paymentLinkId?: string;
  mobileMoneyPhone?: string;    // Phone number used for mobile money
  cardLast4?: string;
  status: PaymentStatus;
  processedAt: string;
  processedBy: string;
  processedByName: string;
  reversedAt?: string;
  reversalReason?: string;
  // Allocation (how this payment was applied)
  allocations?: PaymentAllocation[];
  notes?: string;
  facilityId: string;
  orgId?: string;
  /**
   * Outcome of best-effort mirroring this payment onto BillingDoc(s) via
   * settleOpenBillsWithPayment (see payment-service.ts). Persisted — not just
   * console.warn'd — so a caller can tell a cashier the underlying invoice
   * didn't actually move even though the payment itself (and its ledger
   * credit) succeeded, instead of an unqualified success toast masking a
   * stuck bill. Undefined means settlement fully succeeded (or there was
   * nothing to settle).
   */
  billSettlementError?: string;
  /**
   * Portion of `amount` that settleOpenBillsWithPayment could not match to
   * any open bill for this patient/currency (overpayment, an advance, or no
   * bill on file at all) — the ledger already reflects the full payment;
   * this is just money that isn't pinned to one specific invoice.
   */
  billSettlementUnapplied?: number;
}

export interface PaymentAllocation {
  encounterId: string;
  amount: number;
  chargeId?: string;
}

// ═══ Refund ════════════════════════════════════════════════════════

export interface RefundDoc extends BaseDoc {
  type: 'refund';
  paymentId: string;
  patientId: string;
  patientName: string;
  amount: number;
  currency: string;
  method: PaymentMethodType;    // Usually same as original payment
  reference?: string;
  reason: string;
  status: RefundStatus;
  processedAt?: string;
  processedBy: string;
  processedByName: string;
  facilityId: string;
  orgId?: string;
}

// ═══ Saved Payment Method ══════════════════════════════════════════

export interface SavedPaymentMethodDoc extends BaseDoc {
  type: 'saved_payment_method';
  patientId: string;
  methodType: SavedPaymentMethodType;
  phoneNumber?: string;         // For mobile money
  cardToken?: string;           // Tokenized card (from Flutterwave/Stripe)
  cardLast4?: string;
  cardBrand?: string;           // visa, mastercard, etc.
  cardExpiry?: string;          // MM/YY
  bankName?: string;
  bankAccountLast4?: string;
  label?: string;               // Patient-friendly label: "M-Pesa •••4523"
  isDefault: boolean;
  facilityId: string;
  orgId?: string;
}

// ═══ Payment Plan ══════════════════════════════════════════════════

export interface PaymentPlanDoc extends BaseDoc {
  type: 'payment_plan';
  patientId: string;
  patientName: string;
  totalBalance: number;
  termMonths: number;
  monthlyAmount: number;
  apr: number;                  // 0 for interest-free
  startDate: string;
  endDate: string;
  status: PaymentPlanStatus;
  nextDueDate?: string;
  paidToDate: number;
  remainingBalance: number;
  missedPayments: number;
  lastPaymentDate?: string;
  // Auto-pay
  autoPayEnabled: boolean;
  autoPayMethodId?: string;     // Links to SavedPaymentMethodDoc
  // Related encounters
  encounterIds: string[];
  invoiceIds?: string[];
  // Schedule
  installments: PlanInstallment[];
  // Admin
  createdByStaff: string;
  createdByStaffName: string;
  facilityId: string;
  orgId?: string;
}

export interface PlanInstallment {
  number: number;
  dueDate: string;
  amount: number;
  status: 'pending' | 'paid' | 'missed' | 'partial';
  paidAmount?: number;
  paidDate?: string;
  paymentId?: string;
}

// ═══ Invoice / Statement ═══════════════════════════════════════════

export interface InvoiceDoc extends BaseDoc {
  type: 'invoice';
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  encounterId?: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  insurancePayments: number;
  adjustments: number;
  priorPayments: number;
  totalDue: number;
  currency: string;
  issuedDate: string;
  dueDate: string;
  status: InvoiceStatus;
  sentVia?: 'sms' | 'email' | 'both' | 'print';
  sentAt?: string;
  viewedAt?: string;
  paidAt?: string;
  paymentLinkToken?: string;    // Unique token for SMS/email pay links
  facilityId: string;
  facilityName: string;
  orgId?: string;
}

export interface InvoiceLineItem {
  description: string;
  serviceDate: string;
  billedAmount: number;
  allowedAmount?: number;
  insurancePaid?: number;
  adjustment?: number;
  patientResponsibility: number;
}

// ═══ Ledger Entry (Immutable, Append-Only) ═════════════════════════

export interface LedgerEntryDoc extends BaseDoc {
  type: 'ledger_entry';
  patientId: string;
  encounterId?: string;
  entryType: LedgerEntryType;
  amount: number;               // Positive = debit (patient owes more), Negative = credit (balance decreases)
  runningBalance: number;       // Patient balance AFTER this entry
  description: string;
  referenceId?: string;         // Links to PaymentDoc, AdjustmentDoc, ChargeDoc, RefundDoc, ClaimDoc
  referenceType?: string;       // 'payment' | 'adjustment' | 'charge' | 'refund' | 'claim'
  method?: PaymentMethodType;   // For payments
  currency: string;
  facilityId: string;
  orgId?: string;
}

// ═══ Helper: Patient Financial Summary (computed, not stored) ═══════

export interface PatientFinancialSummary {
  patientId: string;
  totalBalance: number;
  totalInCollections: number;
  currentBalance: number;       // Not yet overdue
  overdueBalance: number;       // Past due date
  activePlanBalance: number;
  insurancePolicies: InsurancePolicyDoc[];
  primaryPolicy?: InsurancePolicyDoc;
  eligibilityStatus: EligibilityStatus | 'none';
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  nextPlanPaymentDate?: string;
  nextPlanPaymentAmount?: number;
  savedPaymentMethods: SavedPaymentMethodDoc[];
  preferredMethod?: SavedPaymentMethodDoc;
  collectionStage: CollectionStage;
}

// ═══ Webhook Payloads (for M-Pesa, Airtel, Flutterwave) ═══════════

export interface MpesaCallbackPayload {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: {
    Item: Array<{ Name: string; Value: string | number }>;
  };
}

export interface FlutterwaveWebhookPayload {
  event: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    charged_amount: number;
    status: string;
    payment_type: string;
    customer: { email?: string; phone_number?: string; name?: string };
  };
}
