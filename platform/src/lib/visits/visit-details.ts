/**
 * What a visit is, recorded when it starts — the questions the OpenMRS O3
 * "Start a visit" form asks beyond the date: which kind of visit, who pays,
 * and whether a booked patient arrived on time.
 *
 * Stored on the visit (the encounter) rather than on the patient: a patient
 * who paid cash last week may be exempt today (an ANC visit, an emergency),
 * and the bill, the cashier and the claim all ask about THIS visit.
 *
 * Check-in records the payer only. It posts no charge: bills are still raised
 * at the services the patient receives, and they read the payer from here.
 */

export type VisitType = 'opd' | 'facility' | 'home' | 'outreach' | 'group';

/** In the order the form lists them — the everyday one first. */
export const VISIT_TYPES: readonly VisitType[] = ['opd', 'facility', 'home', 'outreach', 'group'];

export type VisitPaymentMethod = 'cash' | 'mobile_money' | 'insurance';
export const VISIT_PAYMENT_METHODS: readonly VisitPaymentMethod[] = ['cash', 'mobile_money', 'insurance'];

/**
 * Why a visit is not billed — South Sudan's free-care groups (children under
 * five and maternal care under the Basic Package of Health Services), plus the
 * facility's own: emergencies stabilised before payment, staff, and patients
 * who cannot pay. `other` needs a stated reason.
 */
export type VisitExemption = 'under_five' | 'maternal' | 'emergency' | 'staff' | 'indigent' | 'other';
export const VISIT_EXEMPTIONS: readonly VisitExemption[] = ['under_five', 'maternal', 'emergency', 'staff', 'indigent', 'other'];

export interface VisitBilling {
  payment: 'paying' | 'non_paying';
  /** Paying only. */
  method?: VisitPaymentMethod;
  /** Paying by insurance: the scheme or payer ("CBHI", "AAR Insurance"). */
  insuranceScheme?: string;
  /** Optional, as in O3. Encrypted at rest (phi-field-catalog). */
  policyNumber?: string;
  /** Non-paying only. */
  exemption?: VisitExemption;
  /** Required when `exemption` is `other`. */
  exemptionReason?: string;
}

export type VisitPunctuality = 'early' | 'on_time' | 'late';
export const VISIT_PUNCTUALITY: readonly VisitPunctuality[] = ['early', 'on_time', 'late'];

/** The visit fields check-in writes onto the encounter. */
export interface VisitDetails {
  visitType?: VisitType;
  visitBilling?: VisitBilling;
  punctuality?: VisitPunctuality;
}

/** Minutes either side of the booked time that still count as on time. */
export const ON_TIME_WINDOW_MIN = 15;

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Early / on time / late for a booked arrival, from the booking's Juba
 * wall-clock time and the current one. A suggestion the desk can change:
 * the clock says when the patient reached the desk, not when they reached
 * the gate.
 */
export function derivePunctuality(appointmentTime: string, nowHHMM: string): VisitPunctuality | undefined {
  const booked = toMinutes(appointmentTime);
  const now = toMinutes(nowHHMM);
  if (booked === null || now === null) return undefined;
  if (now < booked - ON_TIME_WINDOW_MIN) return 'early';
  if (now > booked + ON_TIME_WINDOW_MIN) return 'late';
  return 'on_time';
}

/** Whether the billing answers are complete enough to start the visit. */
export function visitBillingComplete(billing: Partial<VisitBilling>): boolean {
  if (billing.payment === 'paying') {
    if (!billing.method) return false;
    if (billing.method === 'insurance') return Boolean(billing.insuranceScheme?.trim());
    return true;
  }
  if (billing.payment === 'non_paying') {
    if (!billing.exemption) return false;
    if (billing.exemption === 'other') return Boolean(billing.exemptionReason?.trim());
    return true;
  }
  return false;
}

/**
 * Only the answers that apply — a method left over from switching to
 * non-paying, or a reason typed before choosing a named exemption, is not
 * written.
 */
export function cleanVisitBilling(billing: Partial<VisitBilling>): VisitBilling | undefined {
  if (billing.payment === 'paying') {
    const insured = billing.method === 'insurance';
    return {
      payment: 'paying',
      method: billing.method,
      insuranceScheme: insured ? billing.insuranceScheme?.trim() || undefined : undefined,
      policyNumber: insured ? billing.policyNumber?.trim() || undefined : undefined,
    };
  }
  if (billing.payment === 'non_paying') {
    return {
      payment: 'non_paying',
      exemption: billing.exemption,
      exemptionReason: billing.exemption === 'other' ? billing.exemptionReason?.trim() || undefined : undefined,
    };
  }
  return undefined;
}
