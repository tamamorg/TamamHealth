/**
 * Turn a caught error into a message a clinician can act on.
 *
 * Services throw three kinds of error: domain errors written for the user
 * ("The bed changed on another workstation. Refresh and try again."), coded
 * errors meant for a caller to translate (`INSURANCE_LINK_MISMATCH`), and
 * internal failures (a PouchDB 500, a fetch TypeError, an invariant message
 * full of field names). Only the first may reach the screen verbatim; codes
 * map through CODE_MESSAGES and everything else falls back to the caller's
 * own sentence, which names the action that did not happen.
 *
 * Message style (see the 2026-10 message rewrite): say what did not happen,
 * why when it is known, and what to do next. Sentence case, a full stop,
 * clinical words rather than system words, no exclamation marks.
 */

// Neutral on purpose: a failed fetch may be a password change or a payment,
// where nothing was kept on the device, so never promise that work was saved.
export const OFFLINE_MESSAGE = 'Cannot reach the server. Check your internet connection and try again.';
export const CONFLICT_MESSAGE =
  'This record was changed on another device. Reload the page to see the latest version, then try again.';
export const SESSION_MESSAGE = 'Your session has ended. Sign in again to continue.';
export const TIMEOUT_MESSAGE = 'This is taking longer than expected. Wait a moment, then try again.';

/** Coded errors (thrown as `new Error('CODE')` or carried on `err.code`). */
export const CODE_MESSAGES: Record<string, string> = {
  // Billing
  INVALID_AMOUNT: 'Enter a payment amount greater than zero.',
  AMOUNT_EXCEEDS_BALANCE: 'The payment is more than the balance due. Enter an amount up to the balance.',
  INVALID_METHOD: 'Choose a payment method from the list.',
  BILL_NOT_PAYABLE: 'This bill cannot take payments in its current status.',
  BILL_PAID: 'This bill is already paid in full.',
  BILL_CANCELLED: 'This bill was cancelled and cannot be changed.',
  BILL_WAIVED: 'This bill has already been waived.',
  BILL_HAS_PAYMENTS: 'This bill has payments applied. Reverse the payments before changing it.',
  CHARGE_REVERSED: 'The charge on this bill was reversed, so it cannot take payments.',
  INVALID_REASON: 'Enter a reason before continuing.',
  // Payments
  PAYMENT_NOT_REVERSIBLE: 'This payment cannot be voided in its current status.',
  PAYMENT_REFUNDED: 'This payment has been refunded and cannot be voided.',
  REFUND_EXCEEDS_REMAINING: 'The refund is more than the amount remaining on this payment.',
  INVALID_PAYMENT_PLAN: 'Check the payment plan: the balance must be above zero and the term between 1 and 120 months.',
  PAYMENT_LINK_NOT_FOUND: 'This payment link was not found. Ask the facility for a new link.',
  PAYMENT_LINK_USED: 'This payment link has already been paid.',
  PAYMENT_LINK_EXPIRED: 'This payment link has expired. Ask the facility for a new link.',
  PAYMENT_LINK_CONFLICT: 'Another payment on this link is in progress. Wait a moment, then try again.',
  // Insurance
  INSURANCE_INVALID_AMOUNT: 'Enter a claim amount greater than zero.',
  INSURANCE_CURRENCY_REQUIRED: 'Choose the currency for this claim.',
  INSURANCE_LINK_MISMATCH:
    'The claim does not match the selected bill or visit. Check the patient, facility and amount, or open the claim from the patient\'s bill.',
  INSURANCE_DUPLICATE_MISMATCH: 'A different claim with this reference already exists. Open the existing claim instead.',
  INSURANCE_RECEIPT_REQUIRED: 'Record the payer\'s receipt before entering the adjudication.',
  INSURANCE_INVALID_EVIDENCE: 'Add a note for the payer (up to 2,000 characters), including how and when the decision was made.',
  INSURANCE_ADJUSTMENT_REVIEW_REQUIRED: 'This claim has a settlement or write-off. A billing supervisor must review it before resubmission.',
  INSURANCE_CONNECTOR_NOT_CONFIGURED: 'Electronic verification is not set up for this payer. Record the decision manually.',
  // Visit workflow
  POST_CONSULT_PENDING: 'The visit has open post-consultation steps. Complete them before checking the patient out.',
  POST_CONSULT_CONFLICT: 'The visit was updated on another device. Reload the page, then check the patient out.',
  USE_HANDOFF_SERVICE: 'This visit step cannot be changed here. Use the visit handoff to move the patient.',
  USE_DISCHARGE_SERVICE: 'Use Discharge to close this visit.',
  AMBIGUOUS_NOTE_ENCOUNTER: 'This patient has more than one open visit. Open the note from its visit.',
  CHECKOUT_BLOCKED: 'Checkout is blocked by open items. Resolve them, or ask a clinician to override.',
  DISCHARGE_FORBIDDEN: 'Only clinical staff or the front desk can check a patient out.',
  DISCHARGE_OVERRIDE_REQUIRES_CLINICIAN_AND_REASON: 'Only a signed-in clinician can override checkout, and a reason is required.',
  // Post-consultation handoff
  HANDOFF_ALREADY_OWNED: 'Another staff member already owns this handoff.',
  HANDOFF_ALREADY_STARTED: 'Work on this handoff has started, so it cannot be bypassed.',
  HANDOFF_CONFLICT: 'This visit changed on another device. Reload the page and try again.',
  HANDOFF_FORBIDDEN: 'Only clinical staff can change this handoff.',
  HANDOFF_INVALID: 'Enter a reason. Only a clinician can bypass a handoff.',
  HANDOFF_INVALID_OWNER: 'Choose an active nurse or clinician.',
  HANDOFF_NOT_ACCEPTED: 'Accept the handoff before completing its tasks.',
  HANDOFF_NOT_ACTIVE: 'This visit has no active handoff.',
  HANDOFF_NOT_FOUND: 'Visit not found. Reload the page.',
  HANDOFF_PLAN_CHANGED: 'The plan changed since you reviewed it. Review it again.',
  // Insurance workflow
  INSURANCE_FORBIDDEN: 'You do not have access to insurance claims.',
  INSURANCE_INVALID_METHOD: 'Choose how the payer sent the receipt.',
  INSURANCE_INVALID_TRANSITION: 'This claim cannot take that step now.',
  INSURANCE_LEGACY_SETTLEMENT_REVIEW: 'This older claim needs a billing supervisor to review its settlement.',
  INSURANCE_NOT_FOUND: 'Claim not found. Reload the page.',
  INSURANCE_OVERPAYMENT_REVIEW: 'The settlement is more than the balance due. A billing supervisor must review it.',
  INSURANCE_REFERENCE_REQUIRED: 'Enter the payer reference (up to 160 characters).',
  INSURANCE_SETTLEMENT_PENDING: 'A settlement with a different reference is already recorded.',
  // Session-shaped guards thrown before any read
  FINANCIAL_EVIDENCE_SCOPE_REQUIRED: SESSION_MESSAGE,
  NO_SCOPE: SESSION_MESSAGE,
};

/** Domain errors whose messages are written for the person at the screen. */
const USER_FACING_ERRORS = new Set([
  'ValidationError', 'NoteIncompleteError', 'AllergyHardStopError', 'AppointmentAmendNotAllowedError',
  'AssessmentAuthorizationError', 'AssessmentLockError', 'BillingError', 'BookingConflictError',
  'ControlledSubstanceError', 'DispenseError', 'DuplicateActiveTriageError', 'MedicationAdministrationError',
  'NoteLockedError', 'NoteSigningAuthorizationError', 'OrganizationNotEmptyError', 'PatientDuplicateError', 'PaymentOperationError',
  'PrescriptionClearanceError', 'ReferralTenantError', 'SignedRecordLockError', 'SigningAuthorizationError',
  'TransferValidationError', 'WardWorkflowError',
]);

/** Text that gives away an internal message: codes, identifiers, HTTP, JS runtime noise. */
const TECHNICAL = /\b\w+_\w+\b|\bHTTP\b|\bstatus \d{3}\b|undefined|\bnull\b|\[object|Cannot read|is not a function|Unexpected token|JSON|\bfetch\b|pouch|couch|Upstash|\[[A-Z-]+\]/i;

/** True when a message reads as a sentence written for a user. */
export function isUserFacingText(message: string): boolean {
  const text = message.trim();
  if (text.length < 8 || text.length > 300) return false;
  if (!/^[A-Z"'‘“0-9]/.test(text) || !/\s/.test(text)) return false;
  // camelCase identifiers (patientId, orgId) are a case-sensitive check.
  if (/\b[a-z]+[A-Z][A-Za-z]*\b/.test(text)) return false;
  return !TECHNICAL.test(text);
}

/**
 * The code a message carries: the whole message, or its head when the thrower
 * appended detail ("CHECKOUT_BLOCKED: rx_dispensed, notes_signed"). The
 * detail is for logs; only the code's sentence reaches the screen.
 */
function leadingCode(text: string): string | undefined {
  const trimmed = text.trim();
  if (CODE_MESSAGES[trimmed]) return trimmed;
  const head = /^([A-Z][A-Z0-9_]{2,}):/.exec(trimmed)?.[1];
  return head && CODE_MESSAGES[head] ? head : undefined;
}

function codeOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && CODE_MESSAGES[code]) return code;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? leadingCode(message) : undefined;
}

/**
 * The sentence to show for `err`. `fallback` names the action that failed
 * ("Blood unit not stocked. Try again.") and is used whenever the error's own
 * text is not fit for a user.
 */
export function describeError(err: unknown, fallback: string): string {
  const code = codeOf(err);
  if (code) return CODE_MESSAGES[code];
  if (!err || typeof err !== 'object') return fallback;

  const e = err as { name?: string; message?: string; status?: number };
  const name = e.name ?? '';
  const message = typeof e.message === 'string' ? e.message.trim() : '';

  if (name === 'TypeError' && /failed to fetch|networkerror|load failed|network request failed/i.test(message)) return OFFLINE_MESSAGE;
  if (name === 'LocalQueryTimeoutError' || name === 'AbortError' || name === 'TimeoutError') return TIMEOUT_MESSAGE;
  if (e.status === 409 || name === 'conflict') return CONFLICT_MESSAGE;
  if (e.status === 401 || /not signed in|session (has )?(expired|ended)/i.test(message)) return SESSION_MESSAGE;

  if (USER_FACING_ERRORS.has(name) && message && !CODE_MESSAGES[message]) return message;
  if (message && isUserFacingText(message)) return message;
  return fallback;
}

/**
 * The sentence to show for a failed `/api/*` response body (`{ error }`).
 * API bodies also serve mobile and integrations, so some are written for a
 * developer ("patientId is required"); those give way to `fallback`.
 */
export function describeApiError(body: unknown, fallback: string): string {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  if (typeof error !== 'string') return fallback;
  const code = leadingCode(error);
  if (code) return CODE_MESSAGES[code];
  return isUserFacingText(error) ? error.trim() : fallback;
}
