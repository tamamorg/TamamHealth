/**
 * Texting a patient, the offline-first way.
 *
 * The message is written to the device first — so it is in the patient's
 * record and survives a dead connection — and only then handed to the server,
 * which holds the gateway credentials (`/api/patient-sms`). What actually
 * happened is stamped back onto the message (`smsDelivery`), because the three
 * outcomes mean very different things to the person who pressed Send:
 *
 *   sent           the gateway accepted it.
 *   queued         no connection, or the server could not act yet. It is
 *                  retried automatically (`flushQueuedPatientTexts`).
 *   not_connected  this deployment has no SMS gateway. Nothing left the
 *                  building; the patient was NOT reached.
 *   failed         the gateway refused it, or it ran out of retries.
 *
 * Before this service the chart's "SMS" channel wrote the message locally,
 * stamped it "sent", and stopped — the text never went anywhere.
 */
import { apiFetch } from '@/lib/api-fetch';
import type { MessageDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { phoneTail, type PatientSmsRequest, type PatientSmsResponse } from '@/lib/sms/patient-dispatch';
import { maskPhone } from '@/lib/sms/text';
import { createMessage, getMessagesByDoctor, updateMessage } from './message-service';

export type PatientTextOutcome = 'sent' | 'queued' | 'not_connected' | 'failed';

export interface PatientTextResult {
  message: MessageDoc;
  outcome: PatientTextOutcome;
  error?: string;
}

export interface SendPatientTextInput {
  patient: { _id: string; name: string; phone?: string };
  text: string;
  subject: string;
  /** Also show the message in the patient portal inbox. */
  channel?: 'sms' | 'both';
  kind?: MessageDoc['messageKind'];
  sender: { _id: string; name: string; hospitalId?: string; hospitalName?: string; orgId?: string };
  consentConfirmed?: boolean;
  patientEducation?: boolean;
  /** Prescriptions this text carries — see `MessageDoc.prescriptionIds`. */
  prescriptionIds?: string[];
}

/** After this many tries a queued text is given up on and shown as failed. */
export const MAX_TEXT_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 20_000;
/** Minutes to wait before attempt n+1 (index = attempts already made). */
const RETRY_BACKOFF_MINUTES = [0, 1, 5, 15, 60, 180];

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function purposeOf(message: MessageDoc): PatientSmsRequest['purpose'] {
  return message.messageKind || 'message';
}

type DispatchVerdict =
  | { kind: 'final'; response: PatientSmsResponse }
  /** No connection: nothing was attempted, so nothing counts against it. */
  | { kind: 'offline' }
  | { kind: 'retry'; error: string }
  | { kind: 'rejected'; error: string };

/** One attempt at the gateway. Never throws. */
async function postToGateway(message: MessageDoc): Promise<DispatchVerdict> {
  if (isOffline()) return { kind: 'offline' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const payload: PatientSmsRequest = {
      patientId: message.patientId,
      text: message.body,
      messageId: message._id,
      purpose: purposeOf(message),
      // Not a destination: the server sends to its own record's number, and
      // refuses if that no longer ends in the digits the sender confirmed.
      phoneTail: phoneTail(message.patientPhone) || undefined,
      consentConfirmed: message.textConsentConfirmed === true,
    };
    const response = await apiFetch('/api/patient-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
    if (response.ok) {
      return { kind: 'final', response: await response.json() as PatientSmsResponse };
    }
    let error = `HTTP ${response.status}`;
    try {
      const parsed = await response.json() as { error?: string };
      if (parsed?.error) error = parsed.error;
    } catch { /* keep the status text */ }
    // The server could not act *yet*: the session lapsed, the patient record
    // has not replicated, it is rate limited, or it is down. Everything else
    // is a verdict on this particular text and will not change on retry.
    //
    // A 409 is usually "not yet" (the record has not replicated, or the same
    // text is mid-flight) — but `phone_changed` is a verdict: the record's
    // number is not the one the sender confirmed, and waiting will not change
    // that. Retrying it reported "saved, will send when online" for hours and
    // let the caller act as if the text were on its way.
    const retryable = response.status === 401 || response.status === 429 || response.status >= 500
      || (response.status === 409 && error !== 'phone_changed');
    return retryable ? { kind: 'retry', error } : { kind: 'rejected', error };
  } catch (err) {
    return { kind: 'retry', error: err instanceof Error ? err.message : 'network error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The server's codes, in the sender's words. */
function explain(error: string): string {
  switch (error) {
    case 'no_phone': return 'No phone number is recorded for this patient.';
    case 'phone_changed': return 'The phone number on the patient record is not the one this text was written for. Check the number and send it again.';
    case 'patient_not_synced': return 'The patient record has not reached the server yet.';
    case 'gateway_unavailable': return 'The SMS gateway could not be reached.';
    case 'in_flight': return 'The text is already being sent.';
    case 'consent_required': return 'Confirm the patient agreed to receive texts on this number, then send it again.';
    case 'destination_not_allowed': return 'This phone number is outside the countries this facility is set up to text.';
    default: return error;
  }
}

/**
 * Messages with a send in progress on this device. A new message is `queued`
 * until its first request returns — up to twenty seconds — and the outbox
 * must not pick it up and send it a second time in that window.
 */
const IN_FLIGHT = new Set<string>();

/** Try to send one saved message and stamp the outcome onto it. */
export async function dispatchPatientText(message: MessageDoc): Promise<PatientTextResult> {
  if (IN_FLIGHT.has(message._id)) return { message, outcome: 'queued', error: 'in_flight' };
  IN_FLIGHT.add(message._id);
  try {
    return await attemptDispatch(message);
  } finally {
    IN_FLIGHT.delete(message._id);
  }
}

async function attemptDispatch(message: MessageDoc): Promise<PatientTextResult> {
  const verdict = await postToGateway(message);
  if (verdict.kind === 'offline') {
    // Not an attempt: the text must go the moment the connection returns,
    // not after a backoff it never earned, and a long offline spell must not
    // use up its retries.
    const queued = await updateMessage(message._id, {
      smsDelivery: { state: 'queued', attempts: message.smsDelivery?.attempts ?? 0, lastAttemptAt: message.smsDelivery?.lastAttemptAt, error: 'offline' },
    });
    return { message: queued ?? message, outcome: 'queued', error: 'offline' };
  }
  const attempts = (message.smsDelivery?.attempts ?? 0) + 1;
  const lastAttemptAt = new Date().toISOString();

  let outcome: PatientTextOutcome;
  let error: string | undefined;
  let smsResult: MessageDoc['smsResult'] | undefined;

  if (verdict.kind === 'final') {
    outcome = verdict.response.state;
    error = verdict.response.error;
    smsResult = {
      ok: verdict.response.state === 'sent',
      providerId: verdict.response.provider,
      providerMessageId: verdict.response.providerMessageId,
      error: verdict.response.error,
    };
  } else if (verdict.kind === 'rejected') {
    outcome = 'failed';
    error = explain(verdict.error);
  } else if (attempts >= MAX_TEXT_ATTEMPTS) {
    outcome = 'failed';
    error = `Not delivered after ${attempts} attempts. ${explain(verdict.error)}`;
  } else {
    outcome = 'queued';
    error = verdict.error;
  }

  // An SMS-only message that did not go out reached nobody; one that also
  // sits in the portal inbox was still delivered there.
  const undelivered = outcome === 'failed' || outcome === 'not_connected';
  // Where the server says it actually sent it — its record, not this device's.
  const sentTo = verdict.kind === 'final' ? verdict.response.to : undefined;
  const updated = await updateMessage(message._id, {
    smsDelivery: { state: outcome, attempts, lastAttemptAt, error, ...(sentTo ? { to: sentTo } : {}) },
    ...(smsResult ? { smsResult } : {}),
    ...(undelivered && message.channel === 'sms' ? { status: 'failed' as const } : {}),
  });
  if (outcome === 'sent') await recordTextedPrescriptions(message, lastAttemptAt, sentTo);
  return { message: updated ?? message, outcome, error };
}

/**
 * A texted prescription counts as handed to the patient only once the gateway
 * has taken it — which may be a retry long after the dialog closed. Recording
 * it here, rather than in the dialog, covers both.
 */
async function recordTextedPrescriptions(message: MessageDoc, at: string, sentTo?: string): Promise<void> {
  if (!message.prescriptionIds?.length) return;
  try {
    const { recordPrescriptionPatientCopy } = await import('@/lib/services/prescription-service');
    for (const id of message.prescriptionIds) {
      await recordPrescriptionPatientCopy(id, {
        channel: 'sms',
        at,
        byId: message.fromDoctorId,
        byName: message.fromDoctorName,
        to: sentTo || maskPhone(message.patientPhone),
        messageId: message._id,
      });
    }
  } catch (err) {
    // The text went out; failing to note it must not turn a sent text into an
    // error for the sender. The message itself remains the record.
    console.warn('[patient-text] could not record the texted prescription copy', err);
  }
}

/**
 * Write the message and try to send it. Resolves with the outcome rather
 * than throwing on a failed send: the record was written either way, and the
 * caller's job is to tell the sender which of the four things happened.
 */
export async function sendPatientText(input: SendPatientTextInput): Promise<PatientTextResult> {
  const message = await createMessage({
    patientId: input.patient._id,
    patientName: input.patient.name,
    patientPhone: input.patient.phone || '',
    recipientType: 'patient',
    direction: 'staff_to_patient',
    fromDoctorId: input.sender._id,
    fromDoctorName: input.sender.name,
    fromHospitalId: input.sender.hospitalId,
    fromHospitalName: input.sender.hospitalName || '',
    subject: input.subject,
    body: input.text,
    channel: input.channel || 'sms',
    sentAt: new Date().toISOString(),
    orgId: input.sender.orgId,
    messageKind: input.kind,
    textConsentConfirmed: input.consentConfirmed || undefined,
    patientEducation: input.patientEducation || undefined,
    prescriptionIds: input.prescriptionIds?.length ? input.prescriptionIds : undefined,
    smsDelivery: { state: 'queued', attempts: 0 },
  });
  return dispatchPatientText(message);
}

/** Whether a queued text's backoff window has passed. */
export function isTextRetryDue(message: MessageDoc, now: Date = new Date()): boolean {
  const delivery = message.smsDelivery;
  if (!delivery || delivery.state !== 'queued') return false;
  if (!delivery.lastAttemptAt) return true;
  const wait = RETRY_BACKOFF_MINUTES[Math.min(delivery.attempts, RETRY_BACKOFF_MINUTES.length - 1)];
  return now.getTime() - new Date(delivery.lastAttemptAt).getTime() >= wait * 60_000;
}

export interface TextFlushOutcome {
  attempted: number;
  sent: number;
  stillQueued: number;
  failed: number;
}

let flushing = false;

/**
 * Retry this user's queued texts. Called when the device comes back online
 * and when the app opens. Only the author's own device retries a message, so
 * two workstations at one facility never both send the same text; the server
 * also refuses a message id it has already sent.
 */
export async function flushQueuedPatientTexts(userId: string, scope: DataScope): Promise<TextFlushOutcome> {
  const outcome: TextFlushOutcome = { attempted: 0, sent: 0, stillQueued: 0, failed: 0 };
  if (flushing || !userId || isOffline()) return outcome;
  flushing = true;
  try {
    const mine = await getMessagesByDoctor(userId, scope);
    const due = mine
      .filter(m => m.channel === 'sms' || m.channel === 'both')
      .filter(m => !IN_FLIGHT.has(m._id) && isTextRetryDue(m))
      // Oldest first: a text written this morning should not wait behind one
      // written a minute ago.
      .sort((a, b) => (a.sentAt || '').localeCompare(b.sentAt || ''));
    for (const message of due) {
      outcome.attempted++;
      const result = await dispatchPatientText(message);
      if (result.outcome === 'sent') outcome.sent++;
      else if (result.outcome === 'queued') outcome.stillQueued++;
      else outcome.failed++;
      // The connection dropped again mid-run — stop spending attempts.
      if (isOffline()) break;
    }
    return outcome;
  } finally {
    flushing = false;
  }
}
