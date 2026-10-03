/**
 * API: /api/patient-sms
 * POST — Dispatch one text message to a patient through the SMS gateway.
 *
 * Why this exists: staff write patient messages on the device (the browser
 * calls the message service directly, so it works offline), but only the
 * server holds the gateway credentials. Until this route, a message saved
 * with channel "SMS" from the chart was written locally, stamped "sent", and
 * went nowhere. The device now writes the message, then asks this route to
 * carry the text — and records what actually happened.
 *
 * It does not create or read message documents: the caller owns the record
 * and stamps the outcome onto it. That keeps one source of truth (the
 * replicated message doc) and lets this route work on a deployment whose
 * server has no copy of the device's data.
 *
 * The recipient number is resolved from the patient's own record on the
 * server, never trusted from the request — otherwise any signed-in account
 * could use the facility's gateway to text arbitrary numbers. The request
 * may carry the last digits of the number the sender SAW; if the record no
 * longer ends in them, the text is refused rather than sent somewhere the
 * sender did not confirm.
 */
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { ALL_STAFF } from '@/lib/sync/write-permissions';
import { MAX_PATIENT_TEXT_LENGTH, maskPhone } from '@/lib/sms/text';
import { isAllowedDestination } from '@/lib/sms/destination-policy';
import {
  MESSAGE_ID_PATTERN, PATIENT_SMS_PURPOSES, PHONE_TAIL_LENGTH, dispatchKey, phoneTail,
  type PatientSmsPurpose, type PatientSmsResponse,
} from '@/lib/sms/patient-dispatch';
import { claimDispatch, recallDispatch, releaseDispatch, settleDispatch } from '@/lib/sms/dispatch-ledger';
import type { UserRole } from '@/lib/db-types';

/** Same grant as writing the message itself (`DOC_WRITE_ROLES.message`). */
const SEND_ROLES: UserRole[] = [...ALL_STAFF];

/** Texts one account may send per hour — bounds a compromised or runaway session. */
const HOURLY_LIMIT = 60;
/**
 * Texts any one patient may be sent per hour, by anyone. The per-account limit
 * says nothing about a single phone: several accounts, or one account's whole
 * allowance, could otherwise be turned on one person.
 */
const PER_PATIENT_HOURLY_LIMIT = 20;
/** Texts one organisation may send per day — a ceiling on gateway spend. */
const PER_ORG_DAILY_LIMIT = 2000;

/**
 * What a provider's failure means for the sender.
 *
 * Providers report errors as free text, and that text can quote the number
 * it was sent to — so it is classified here and never passed on verbatim.
 */
function classifyGatewayError(error: string | undefined): { kind: 'not_configured' | 'unavailable' | 'rejected'; code: string } {
  const raw = (error || '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'credentials_missing' || lower === 'from_missing') return { kind: 'not_configured', code: 'gateway_not_configured' };
  // The gateway could not be reached or is struggling: the same text may
  // well go through on a later try.
  if (lower.startsWith('network_error') || /^http_(5\d\d|408|429)\b/.test(lower)) {
    return { kind: 'unavailable', code: 'gateway_unavailable' };
  }
  // A bare status word from the gateway ("InsufficientBalance",
  // "InvalidPhoneNumber", "undelivered") tells staff what to fix and carries
  // no patient data; anything longer is replaced by the fixed code.
  return { kind: 'rejected', code: /^[A-Za-z_]{3,40}$/.test(raw) ? `gateway_rejected: ${raw}` : 'gateway_rejected' };
}

async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, SEND_ROLES)) return forbidden();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    const purpose: PatientSmsPurpose = PATIENT_SMS_PURPOSES.includes(body.purpose as PatientSmsPurpose)
      ? body.purpose as PatientSmsPurpose
      : 'message';
    const expectedTail = typeof body.phoneTail === 'string' ? body.phoneTail.replace(/\D/g, '') : '';
    if (!patientId || !text) {
      return NextResponse.json({ error: 'patientId and text are required' }, { status: 400 });
    }
    // Every text belongs to a message document the sender's device wrote: it
    // is the record of what was said, and the id is what makes a retry safe.
    if (!MESSAGE_ID_PATTERN.test(messageId)) {
      return NextResponse.json({ error: 'messageId must name the message document carrying this text' }, { status: 400 });
    }
    if (text.length > MAX_PATIENT_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Text is too long (${text.length} characters; the limit is ${MAX_PATIENT_TEXT_LENGTH}).` },
        { status: 400 },
      );
    }
    // Consent is checked here, not only in the dialog that asks for it: the
    // route is callable by anything holding a session, and a patient who
    // refused texts must not get one because a different screen forgot to ask.
    if (body.consentConfirmed !== true) {
      return NextResponse.json({ error: 'consent_required' }, { status: 422 });
    }

    const { rateLimit } = await import('@/lib/rate-limit');
    const hour = 60 * 60 * 1000;
    const limits = [
      { key: `patient-sms:${auth.sub}`, limit: HOURLY_LIMIT, windowMs: hour },
      { key: `patient-sms:patient:${patientId}`, limit: PER_PATIENT_HOURLY_LIMIT, windowMs: hour },
      ...(auth.orgId ? [{ key: `patient-sms:org:${auth.orgId}`, limit: PER_ORG_DAILY_LIMIT, windowMs: 24 * hour }] : []),
    ];
    for (const limit of limits) {
      const verdict = await rateLimit(limit);
      if (verdict.allowed) continue;
      const response = NextResponse.json({ error: 'Too many texts sent. Please try again later.' }, { status: 429 });
      response.headers.set('Retry-After', String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))));
      return response;
    }

    const { getSmsProvider, sendSms } = await import('@/lib/sms');
    const provider = getSmsProvider();
    // The no-op provider exists so an unconfigured deploy keeps working; it
    // must never be reported to a clinician as a text that reached a patient.
    const connected = provider.name !== 'noop';

    // The patient record is the only trusted source of the number. A server
    // with no copy of the record (a standalone demo, or a patient registered
    // moments ago that has not replicated yet) cannot vouch for one. A record
    // outside the caller's scope is answered exactly like one that does not
    // exist, so this route cannot be used to probe another tenant's ids.
    let phone = '';
    let known = false;
    const { isStandaloneDemo } = await import('@/modules/identity/core/server-users');
    if (!isStandaloneDemo()) {
      const { getPatientById } = await import('@/lib/services/patient-service');
      const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
      let patient: Awaited<ReturnType<typeof getPatientById>> = null;
      try {
        patient = await getPatientById(patientId);
      } catch {
        // A storage outage is not "no such patient" — let the device retry.
        return NextResponse.json({ error: 'patient_lookup_failed' }, { status: 503 });
      }
      if (patient && filterByScope([patient], buildScopeFromAuth(auth)).length > 0) {
        known = true;
        phone = (patient.phone || '').trim();
      }
    }

    if (!connected) {
      const response: PatientSmsResponse = { state: 'not_connected', provider: provider.name };
      return NextResponse.json(response);
    }
    if (!known) {
      // Retryable: the device keeps the text queued until the record arrives.
      return NextResponse.json({ error: 'patient_not_synced' }, { status: 409 });
    }

    // A retry of a text this sender already sent to this patient.
    const key = dispatchKey(auth.sub, patientId, messageId);
    const earlier = await recallDispatch(key);
    if (earlier) return NextResponse.json({ ...earlier, duplicate: true } satisfies PatientSmsResponse);

    if (!phone) {
      return NextResponse.json({ error: 'no_phone' }, { status: 422 });
    }
    // A number being on a chart does not make it one the facility should pay
    // to reach — see lib/sms/destination-policy.
    if (!isAllowedDestination(phone)) {
      return NextResponse.json({ error: 'destination_not_allowed' }, { status: 422 });
    }
    // The sender confirmed consent for a specific number. If the record has
    // moved on (or has not caught up), send nothing rather than text a number
    // nobody approved — a replaced number may be a lost or unsafe phone.
    if (expectedTail.length >= 4 && phoneTail(phone).slice(-expectedTail.length) !== expectedTail.slice(-PHONE_TAIL_LENGTH)) {
      return NextResponse.json({ error: 'phone_changed' }, { status: 409 });
    }

    const claim = await claimDispatch(key);
    if (claim.kind === 'sent') {
      // Another request (or another instance) sent it between the look above
      // and this claim.
      return NextResponse.json({ ...claim.response, duplicate: true } satisfies PatientSmsResponse);
    }
    if (claim.kind === 'in_flight') {
      // The same text is already with the gateway (the sender's click and the
      // outbox retry raced). Retryable: the next try gets the recorded answer.
      return NextResponse.json({ error: 'in_flight' }, { status: 409 });
    }
    let result: Awaited<ReturnType<typeof sendSms>>;
    try {
      result = await sendSms({ to: phone, body: text });
    } catch (err) {
      await releaseDispatch(key);
      throw err;
    }

    const { logAuditSafe } = await import('@/lib/services/audit-service');
    // Never the body or the number. The digest and length tie the audit entry
    // to the message document, so what was said can be proven without the
    // audit log holding a second copy of it.
    const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
    const audit = (state: string) => logAuditSafe('PATIENT_TEXT_DISPATCH', auth.sub, auth.username,
      `${purpose} text for patient ${patientId} via ${result.providerId}: ${state}; `
      + `message ${messageId}; ${text.length} chars; sha256 ${digest}`);
    // The digest proves a message document says what was sent — but only if
    // that document exists. The route cannot insist on it (the device may be
    // ahead of replication), and a caller that never writes one would leave a
    // text nobody can read back. So where PHI encryption is on, the text is
    // kept, encrypted, in its own audit entry: unreadable in the log, and
    // recoverable by whoever holds the key. Without encryption it is not
    // stored at all — a plaintext copy in the audit log is the worse outcome.
    const keepText = async () => {
      const { isEncryptionEnabled, encryptField } = await import('@/lib/field-encryption');
      if (!isEncryptionEnabled()) return;
      await logAuditSafe('PATIENT_TEXT_BODY', auth.sub, auth.username,
        `message ${messageId} to patient ${patientId}; sha256 ${digest}; ${encryptField(text)}`);
    };

    if (result.ok) {
      const response: PatientSmsResponse = {
        state: 'sent', provider: result.providerId, providerMessageId: result.providerMessageId, to: maskPhone(phone),
      };
      await settleDispatch(key, response);
      await audit('sent');
      await keepText().catch(() => { /* the dispatch entry above still stands */ });
      return NextResponse.json(response);
    }

    // Nothing was sent: give the claim back so a retry can try again.
    await releaseDispatch(key);
    const failure = classifyGatewayError(result.error);
    await audit(failure.code);
    if (failure.kind === 'not_configured') {
      // A provider is selected but cannot work: for the sender this is the
      // same fact as no gateway at all — nothing left, and it is not theirs to fix.
      return NextResponse.json({ state: 'not_connected', provider: result.providerId } satisfies PatientSmsResponse);
    }
    if (failure.kind === 'unavailable') {
      return NextResponse.json({ error: failure.code }, { status: 503 });
    }
    return NextResponse.json({ state: 'failed', provider: result.providerId, error: failure.code } satisfies PatientSmsResponse);
  } catch (err) {
    logApiError('[API /patient-sms POST]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'patient.sms.send' });
