/**
 * The contract between a device and `/api/patient-sms`, plus the server's
 * short memory of what it has already sent.
 *
 * Kept out of the route file (a Next.js route may only export its handlers)
 * and free of provider imports, so the browser can share the types.
 */

export type PatientSmsState = 'sent' | 'not_connected' | 'failed';

export interface PatientSmsResponse {
  /**
   * `sent` — the gateway accepted the text.
   * `not_connected` — this server has no working SMS gateway; nothing left.
   * `failed` — the gateway refused it (bad number, no credit, …).
   */
  state: PatientSmsState;
  provider: string;
  providerMessageId?: string;
  /** A fixed code, never the gateway's raw text (which can quote the number). */
  error?: string;
  /** The number the text actually went to, masked. */
  to?: string;
  /** This message id was already dispatched; the earlier outcome is returned. */
  duplicate?: boolean;
}

/**
 * What a device posts. The recipient is NOT taken from it — the server reads
 * the number from the patient's record. `phoneTail` only lets the server
 * refuse when its record no longer matches the number the sender saw and
 * confirmed consent for.
 */
export interface PatientSmsRequest {
  patientId: string;
  text: string;
  /** The message document carrying this text; makes a retry idempotent. */
  messageId: string;
  purpose?: PatientSmsPurpose;
  /** Last digits of the number shown to the sender. */
  phoneTail?: string;
  /**
   * The sender confirmed the patient agreed to be texted on this number. The
   * route refuses a text without it: a consent step that lived only in one
   * dialog was no check at all for any other caller.
   */
  consentConfirmed?: boolean;
}

export const PATIENT_SMS_PURPOSES = ['prescription', 'visit_summary', 'message'] as const;
export type PatientSmsPurpose = typeof PATIENT_SMS_PURPOSES[number];

/** `msg-<uuid>` — the id `message-service` gives every message document. */
export const MESSAGE_ID_PATTERN = /^msg-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Digits compared between the sender's number and the record's. */
export const PHONE_TAIL_LENGTH = 6;

/** The trailing digits of a phone number, formatting and country code aside. */
export function phoneTail(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-PHONE_TAIL_LENGTH);
}

/**
 * Outcomes by dispatch key, so a retry of a request whose response was lost
 * (the usual failure on a weak connection) cannot text the patient twice.
 * The key binds the message to the sender and the patient: an id replayed
 * against another patient, or by another account, is a different dispatch.
 *
 * Per-process and bounded: it guards the retry window, not all of history. A
 * deployment running more than one instance needs a shared store here.
 */
const DISPATCHED = new Map<string, { at: number; response: PatientSmsResponse }>();
/** Dispatches handed to the gateway and not yet answered. */
const IN_FLIGHT = new Set<string>();
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

export function dispatchKey(senderId: string, patientId: string, messageId: string): string {
  return `${senderId}:${patientId}:${messageId}`;
}

export function rememberDispatch(key: string, response: PatientSmsResponse, now: number = Date.now()): void {
  if (DISPATCHED.size >= MAX_ENTRIES) {
    const oldest = DISPATCHED.keys().next().value;
    if (oldest !== undefined) DISPATCHED.delete(oldest);
  }
  DISPATCHED.set(key, { at: now, response });
}

export function recallDispatch(key: string, now: number = Date.now()): PatientSmsResponse | null {
  const hit = DISPATCHED.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    DISPATCHED.delete(key);
    return null;
  }
  return hit.response;
}

/**
 * Claim a dispatch before calling the gateway. False means the same text is
 * already on its way — two requests racing (the sender's click and the outbox
 * retry) must not both reach the gateway.
 */
export function beginDispatch(key: string): boolean {
  if (IN_FLIGHT.has(key)) return false;
  IN_FLIGHT.add(key);
  return true;
}

export function endDispatch(key: string): void {
  IN_FLIGHT.delete(key);
}

/** Test hook: forget every remembered dispatch. */
export function resetDispatchLedgerForTest(): void {
  DISPATCHED.clear();
  IN_FLIGHT.clear();
}
