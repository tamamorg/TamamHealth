/**
 * Billing & Payments types for private-sector facilities.
 * Supports consultation fees, lab charges, pharmacy charges, and
 * insurance-based billing common in East African healthcare.
 */
import type { BaseDoc, FacilityLevel } from './db-types';

export type BillingStatus = 'draft' | 'pending' | 'partial' | 'paid' | 'waived' | 'cancelled' | 'insurance_pending' | 'insurance_approved' | 'insurance_rejected';
export type PaymentMethod = 'cash' | 'mobile_money' | 'bank_transfer' | 'insurance' | 'credit' | 'waiver';
export type ChargeCategory = 'consultation' | 'laboratory' | 'pharmacy' | 'radiology' | 'procedure' | 'bed_charge' | 'admission_deposit' | 'surgery' | 'ambulance' | 'dental' | 'dialysis' | 'optical' | 'cardiac_diagnostics' | 'mental_health' | 'theatre' | 'rehabilitation' | 'other';
export type BillingUnit = 'each' | 'session' | 'night' | 'procedure' | 'item';

/** Price-free starter catalogue: facilities set approved prices/effective dates. */
export const SPECIALTY_BILLING_CATALOG: readonly { category: ChargeCategory; serviceCode: string; serviceName: string; billingUnit: BillingUnit }[] = [
  { category: 'dental', serviceCode: 'DENT-CONSULT', serviceName: 'Dental consultation', billingUnit: 'each' },
  { category: 'dialysis', serviceCode: 'DIAL-HD-SESSION', serviceName: 'Haemodialysis session', billingUnit: 'session' },
  { category: 'optical', serviceCode: 'OPT-REFRACTION', serviceName: 'Refraction assessment', billingUnit: 'each' },
  { category: 'cardiac_diagnostics', serviceCode: 'CARD-ECG', serviceName: '12-lead ECG', billingUnit: 'each' },
  { category: 'mental_health', serviceCode: 'MH-ASSESS', serviceName: 'Mental health assessment', billingUnit: 'each' },
  { category: 'theatre', serviceCode: 'THEATRE-USE', serviceName: 'Operating theatre use', billingUnit: 'procedure' },
  { category: 'rehabilitation', serviceCode: 'REHAB-SESSION', serviceName: 'Physiotherapy session', billingUnit: 'session' },
] as const;

export interface BillLineItem {
  id: string;
  category: ChargeCategory;
  description: string;
  quantity: number;
  unitPrice: number;
  billingUnit?: BillingUnit;
  totalPrice: number;
  referenceId?: string;     // Links to lab order, prescription, etc.
  referenceType?: string;   // 'lab_result' | 'prescription' | 'appointment'
}

export interface PaymentRecord {
  id: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;       // Receipt number, mobile money transaction ID, etc.
  receivedBy: string;
  receivedByName: string;
  receivedAt: string;
  notes?: string;
  /**
   * Back-link to the PaymentDoc (`tamamhealth_payments`) this record mirrors,
   * set only when the payment was applied via `settleOpenBillsWithPayment`
   * (a patient-level payment spread across bills) rather than `recordPayment`
   * (a payment taken directly against this bill, which has no separate
   * PaymentDoc). Lets a retried settlement of the same payment skip bills it
   * already touched, and lets `unsettleBillsForPayment` find exactly which
   * records a reversal must undo.
   */
  sourcePaymentId?: string;
  /** Set when a reversal (see `unsettleBillsForPayment`) has undone this
   *  specific record. The record is kept (not deleted) as a receipt of what
   *  was actually collected and when; `reversed` is what stops it counting
   *  toward the bill's amountPaid. */
  reversed?: boolean;
  reversedAt?: string;
}

export interface BillingDoc extends BaseDoc {
  type: 'billing';
  // Patient
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  // Facility
  facilityId: string;
  facilityName: string;
  facilityLevel: FacilityLevel;
  // Visit context
  encounterDate: string;
  encounterId?: string;     // Link to medical record
  appointmentId?: string;
  // Line items
  items: BillLineItem[];
  // Totals
  subtotal: number;
  discount: number;
  discountReason?: string;
  taxRate: number;           // Percentage (0 for public, varies for private)
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  // Currency
  currency: string;          // SSP (South Sudanese Pound), USD, etc.
  // Payments
  payments: PaymentRecord[];
  // Insurance
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceCoveragePercent?: number;
  insuranceClaimStatus?: 'none' | 'queued' | 'submitted' | 'approved' | 'rejected' | 'partial';
  insuranceApprovedAmount?: number;
  // Status
  status: BillingStatus;
  // Finalization — a bill stays editable (items, discount, delete) until a
  // cashier finalizes it; payments can only be recorded after finalization.
  finalizedAt?: string;
  finalizedBy?: string;
  finalizedByName?: string;
  // Audit
  generatedBy: string;
  generatedByName: string;
  invoiceNumber: string;
  // Administrative
  state: string;
  county?: string;
  orgId?: string;
  notes?: string;
}

/**
 * Fee schedule item — defines standard charges per facility.
 */
export interface FeeScheduleDoc extends BaseDoc {
  type: 'fee_schedule';
  facilityId: string;
  facilityName: string;
  category: ChargeCategory;
  serviceCode: string;
  serviceName: string;
  unitPrice: number;
  billingUnit?: BillingUnit;
  currency: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  orgId?: string;
}
