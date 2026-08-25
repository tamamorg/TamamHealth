/**
 * Patient reminders — queue a message to reach a patient on a future date, e.g.
 * "Come fasted in 3 weeks for your path tests." The HealthBridge "SMS the
 * patient, queued and sent a few days before" idea.
 *
 * IMPORTANT: there is no SMS/WhatsApp gateway wired into this app, so these are
 * an honest reminder QUEUE that staff work from and mark as sent — not a claim
 * of automated delivery. A real gateway can later pick up `getDueReminders()`
 * (status 'queued', sendDate reached) and dispatch them.
 *
 * Synced org-scoped, excluded from national analytics (see coverage matrix).
 */
import { v4 as uuidv4 } from 'uuid';
import { patientRemindersDB } from '../db';
import type { PatientReminderDoc, ReminderChannel } from '../db-types';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { todayIso } from '@/lib/date-utils';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';

function todayISO(): string {
  return todayIso();
}

/** Queued first (earliest send date), then the rest newest-first. */
function reminderOrder(a: PatientReminderDoc, b: PatientReminderDoc): number {
  if (a.status !== b.status) {
    if (a.status === 'queued') return -1;
    if (b.status === 'queued') return 1;
  }
  if (a.status === 'queued' && b.status === 'queued') return (a.sendDate || '').localeCompare(b.sendDate || '');
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
}

/** All reminders for a patient. */
export async function getRemindersByPatient(patientId: string, scope?: DataScope): Promise<PatientReminderDoc[]> {
  let rows = await findByType<PatientReminderDoc>(
    patientRemindersDB(),
    'patient_reminder',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  if (scope) rows = filterByScope(rows, scope);
  return rows.sort(reminderOrder);
}

/** Queued reminders whose send date has arrived — what a gateway would dispatch. */
export async function getDueReminders(asOf: string = todayISO()): Promise<PatientReminderDoc[]> {
  const rows = await findByType<PatientReminderDoc>(patientRemindersDB(), 'patient_reminder');
  return rows.filter((r) => r.status === 'queued' && (r.sendDate || '') <= asOf).sort(reminderOrder);
}

export interface QueueReminderInput {
  patientId: string;
  patientName?: string;
  message: string;
  sendDate: string;
  channel?: ReminderChannel;
  createdById?: string;
  createdByName?: string;
  hospitalId?: string;
  orgId?: string;
}

export async function queueReminder(input: QueueReminderInput): Promise<PatientReminderDoc> {
  const message = (input.message || '').trim();
  if (!message) throw new Error('A reminder message is required');
  if (!input.sendDate) throw new Error('A send date is required');
  const db = patientRemindersDB();
  const now = new Date().toISOString();
  const doc: PatientReminderDoc = {
    _id: `prem-${uuidv4()}`,
    type: 'patient_reminder',
    patientId: input.patientId,
    patientName: input.patientName,
    message,
    sendDate: input.sendDate,
    channel: input.channel ?? 'sms',
    status: 'queued',
    createdById: input.createdById,
    createdByName: input.createdByName,
    hospitalId: input.hospitalId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('QUEUE_PATIENT_REMINDER', input.createdById, input.createdByName, `Queued ${doc.channel} reminder for patient ${doc.patientId} on ${doc.sendDate}`);
  emitSyncEvent({ resourceType: 'patient_reminder', resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  return doc;
}

async function setStatus(id: string, status: PatientReminderDoc['status'], extra: Partial<PatientReminderDoc>, action: string): Promise<PatientReminderDoc | null> {
  const db = patientRemindersDB();
  let existing: PatientReminderDoc;
  try {
    existing = (await db.get(id)) as PatientReminderDoc;
  } catch {
    return null;
  }
  const updated: PatientReminderDoc = { ...existing, ...extra, status, updatedAt: new Date().toISOString() };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe(action, undefined, undefined, `Reminder ${id} → ${status} for patient ${updated.patientId}`);
  emitSyncEvent({ resourceType: 'patient_reminder', resourceId: id, operation: 'update', resourceVersion: updated._rev, hospitalId: updated.hospitalId, orgId: updated.orgId });
  return updated;
}

/** Mark a reminder as sent (staff confirm the patient was contacted). */
export async function markReminderSent(id: string): Promise<PatientReminderDoc | null> {
  return setStatus(id, 'sent', { sentAt: new Date().toISOString() }, 'MARK_REMINDER_SENT');
}

/** Cancel a queued reminder. */
export async function cancelReminder(id: string): Promise<PatientReminderDoc | null> {
  return setStatus(id, 'cancelled', {}, 'CANCEL_PATIENT_REMINDER');
}

// ── Gateway dispatch ─────────────────────────────────────────────────────────

export interface ReminderDispatchOutcome {
  attempted: number;
  sent: number;
  /** Attempts that failed this run but will be retried. */
  failed: number;
  /** Reminders that exhausted MAX_DISPATCH_ATTEMPTS and are now terminal. */
  permanentlyFailed: number;
  /** Due but still inside their backoff window — retried on a later run. */
  skippedBackoff: number;
  skippedNoPhone: number;
  skippedChannel: number;
  gatewayEnabled: boolean;
}

/**
 * Retry policy (KAN-104).
 *
 * Transient gateway failures — a timeout, a 5xx, a network drop on a facility
 * with intermittent connectivity — must not consume the reminder. Equally, a
 * permanently bad number must not be retried forever and must become visible
 * to staff rather than sitting in the queue looking like it is still coming.
 *
 * Backoff is measured in hours because dispatch runs daily; the escalating
 * delay keeps a single bad number from occupying every run.
 */
export const MAX_DISPATCH_ATTEMPTS = 4;
const BACKOFF_HOURS = [0, 1, 6, 24];

/** True when this reminder's backoff window has elapsed and it may be retried. */
export function isRetryDue(reminder: PatientReminderDoc, now: Date = new Date()): boolean {
  const attempts = reminder.attempts ?? 0;
  if (attempts === 0) return true;
  if (!reminder.lastAttemptAt) return true;
  const waitHours = BACKOFF_HOURS[Math.min(attempts, BACKOFF_HOURS.length - 1)];
  const elapsedMs = now.getTime() - new Date(reminder.lastAttemptAt).getTime();
  return elapsedMs >= waitHours * 3_600_000;
}

/**
 * Dispatch due SMS reminders through the configured gateway (lib/sms — Africa's
 * Talking, Twilio, or noop). Server-side only: providers read secret env vars.
 *
 * Opt-in per deployment via PATIENT_REMINDER_SMS_ENABLED='true' (mirrors the
 * appointment-reminder flag) so an unconfigured deploy keeps the honest
 * staff-worked queue instead of silently "sending" via the noop provider.
 *
 * Reminders that fail to send stay `queued` so staff still see and work them —
 * delivery failure must never silently drop a clinical recall.
 */
export async function dispatchDueReminders(asOf: string = todayISO()): Promise<ReminderDispatchOutcome> {
  const gatewayEnabled = process.env.PATIENT_REMINDER_SMS_ENABLED === 'true';
  const outcome: ReminderDispatchOutcome = {
    attempted: 0, sent: 0, failed: 0, permanentlyFailed: 0,
    skippedBackoff: 0, skippedNoPhone: 0, skippedChannel: 0, gatewayEnabled,
  };
  if (!gatewayEnabled) return outcome;

  const due = await getDueReminders(asOf);
  if (due.length === 0) return outcome;

  // Dynamic imports keep the SMS provider layer and the patients DB accessor
  // out of client bundles that import this service via usePatientReminders.
  const { sendSms } = await import('../sms');
  const { patientsDB } = await import('../db');

  for (const reminder of due) {
    // Only SMS-channel reminders go through the gateway; calls / in-person
    // reminders remain staff-worked queue items.
    if (reminder.channel !== 'sms' && reminder.channel !== 'whatsapp') {
      outcome.skippedChannel++;
      continue;
    }
    let phone = '';
    try {
      const patient = await patientsDB().get(reminder.patientId) as { phone?: string };
      phone = patient?.phone || '';
    } catch { /* patient missing — treated as no phone below */ }
    if (!phone) {
      outcome.skippedNoPhone++;
      continue;
    }
    // Respect the backoff window so a run that fires while a reminder is still
    // cooling off doesn't burn one of its attempts.
    if (!isRetryDue(reminder)) {
      outcome.skippedBackoff++;
      continue;
    }

    outcome.attempted++;
    const attempts = (reminder.attempts ?? 0) + 1;
    const attemptedAt = new Date().toISOString();
    try {
      const result = await sendSms({ to: phone, body: reminder.message });
      if (result.ok) {
        // Status flips to 'sent' immediately, which is also what makes dispatch
        // idempotent: getDueReminders only returns 'queued', so a second run —
        // or two runs overlapping — cannot re-send the same reminder.
        await setStatus(reminder._id, 'sent',
          { sentAt: attemptedAt, attempts, lastAttemptAt: attemptedAt },
          'DISPATCH_REMINDER_SMS');
        outcome.sent++;
      } else {
        await recordFailure(reminder, attempts, attemptedAt, result.error || 'gateway rejected the message', outcome);
      }
    } catch (err) {
      await recordFailure(reminder, attempts, attemptedAt,
        err instanceof Error ? err.message : String(err), outcome);
    }
  }

  await logAuditSafe(
    'DISPATCH_PATIENT_REMINDERS',
    undefined,
    undefined,
    `SMS dispatch: ${outcome.sent} sent, ${outcome.failed} retryable failures, ` +
    `${outcome.permanentlyFailed} permanently failed, ${outcome.skippedBackoff} in backoff, ` +
    `${outcome.skippedNoPhone} no phone, ${outcome.skippedChannel} non-SMS`,
  );
  return outcome;
}

/**
 * Record a failed dispatch attempt. Stays `queued` (and therefore retryable)
 * until MAX_DISPATCH_ATTEMPTS is exhausted, then becomes terminal `failed` so
 * staff can see the patient was not reached rather than assuming it is still
 * on its way.
 */
async function recordFailure(
  reminder: PatientReminderDoc,
  attempts: number,
  attemptedAt: string,
  error: string,
  outcome: ReminderDispatchOutcome,
): Promise<void> {
  const terminal = attempts >= MAX_DISPATCH_ATTEMPTS;
  await setStatus(
    reminder._id,
    terminal ? 'failed' : 'queued',
    { attempts, lastAttemptAt: attemptedAt, lastError: error.slice(0, 300) },
    terminal ? 'DISPATCH_REMINDER_FAILED' : 'DISPATCH_REMINDER_RETRY',
  );
  if (terminal) outcome.permanentlyFailed++;
  else outcome.failed++;
}
