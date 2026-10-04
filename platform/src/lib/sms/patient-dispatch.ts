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
 * Binds a dispatch to its sender and patient. What has been sent under each
 * key is remembered server-side, in `dispatch-ledger.ts`.
 */
export function dispatchKey(senderId: string, patientId: string, messageId: string): string {
  return `${senderId}:${patientId}:${messageId}`;
}
