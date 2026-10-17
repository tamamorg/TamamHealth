/**
 * API: /api/messages
 * GET  — List messages by patient or doctor
 * POST — Create, update status, or remove messages. Nothing here erases a
 *        message: "delete" retracts it from the thread and keeps the content.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { AUDIT_ACTION_HEADER, withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import { authorizeJson } from '@/lib/api-json-guard';
// hospital_manager and medical_biller both hold the /messages route in
// role-routes.ts (and DOC_WRITE_ROLES.message is ALL_STAFF, which already
// covers both) — this pair of lists had drifted behind that grant.
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife',
  'medical_superintendent', 'lab_tech', 'pharmacist', 'front_desk', 'cashier',
  'county_health_director',
  'data_entry_clerk', 'hrio', 'nutritionist', 'radiologist',
  'hospital_manager', 'medical_biller',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife',
  'medical_superintendent', 'lab_tech', 'pharmacist', 'front_desk', 'cashier',
  'county_health_director',
  'data_entry_clerk', 'hrio', 'nutritionist', 'radiologist',
  'hospital_manager', 'medical_biller',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllMessages, getMessagesByPatient, getMessagesByDoctor } = await import('@/modules/communication/services/message-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const doctorId = url.searchParams.get('doctorId');
    let messages;
    if (patientId) {
      messages = await getMessagesByPatient(patientId, scope);
    } else if (doctorId) {
      messages = await getMessagesByDoctor(doctorId, scope);
    } else {
      messages = await getAllMessages(scope);
    }
    return NextResponse.json({ messages });
  } catch (err) {
    logApiError('[API /messages GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const guarded = await authorizeJson(request, WRITE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    const action = body.action as string;
    // Update message status
    if (action === 'update-status' && body.messageId) {
      const { updateMessage } = await import('@/modules/communication/services/message-service');
      const { messagesDB } = await import('@/lib/db');
      const { filterByScope, buildScopeFromAuth } = await import('@/lib/services/data-scope');
      try {
        const existing = await messagesDB().get(body.messageId as string);
        if (filterByScope([existing as unknown as Record<string, unknown>], buildScopeFromAuth(auth)).length === 0) {
          return forbidden('Access denied to this message');
        }
      } catch {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      }
      const status = body.status;
      if (status !== 'sent' && status !== 'delivered' && status !== 'failed') {
        return NextResponse.json({ error: 'status must be sent, delivered or failed' }, { status: 400 });
      }
      const updated = await updateMessage(body.messageId as string, { status });
      if (!updated) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      return NextResponse.json({ message: updated }, { headers: { [AUDIT_ACTION_HEADER]: 'message.update' } });
    }
    // Remove a message from its thread. Messages are part of the record, so
    // this is a retraction by the author and never an erasure: the document
    // and its content stay, stamped with who removed it and when.
    if (action === 'delete' && body.messageId) {
      const { retractMessage } = await import('@/modules/communication/services/message-service');
      const { messagesDB } = await import('@/lib/db');
      const { filterByScope, buildScopeFromAuth } = await import('@/lib/services/data-scope');
      try {
        const existing = await messagesDB().get(body.messageId as string);
        if (filterByScope([existing as unknown as Record<string, unknown>], buildScopeFromAuth(auth)).length === 0) {
          return forbidden('Access denied to this message');
        }
      } catch {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      }
      const headers = { [AUDIT_ACTION_HEADER]: 'message.retract' };
      const result = await retractMessage(body.messageId as string, { id: auth.sub, name: auth.name });
      if (result === 'not_found') return NextResponse.json({ error: 'Message not found' }, { status: 404, headers });
      if (result === 'not_author') {
        return NextResponse.json({ error: 'Only the author can remove a message' }, { status: 403, headers });
      }
      return NextResponse.json({ deleted: true, retained: true }, { headers });
    }
    // Create new message
    if (!body.patientId || !body.content) {
      return NextResponse.json(
        { error: 'patientId and content are required' },
        { status: 400 }
      );
    }
    // Per-sender limits. Messages can fan out to the SMS gateway (cost, and a
    // way to text arbitrary people), so SMS-bearing sends get a tighter cap.
    const { rateLimit } = await import('@/lib/rate-limit');
    const channel = (body.channel as 'app' | 'sms' | 'both') || 'app';
    const sendsSms = channel === 'sms' || channel === 'both';
    const general = await rateLimit({ key: `messages:create:${auth.sub}`, limit: 30, windowMs: 60_000 });
    const smsVerdict = sendsSms
      ? await rateLimit({ key: `messages:sms:${auth.sub}`, limit: 10, windowMs: 10 * 60_000 })
      : null;
    if (!general.allowed || (smsVerdict && !smsVerdict.allowed)) {
      return NextResponse.json({ error: 'Too many messages. Please try again later.' }, { status: 429 });
    }
    const recipientType = (body.recipientType as 'patient' | 'staff') || 'patient';
    // The destination comes from a record inside the caller's scope -- never
    // from the request body. A patient recipient must be in scope; a staff
    // recipient must be a user of the caller's own organization.
    let recipientName = '';
    let recipientPhone = '';
    // Tenant of the resolved recipient: stamped on the message so it is visible
    // to the recipient's org even when the sender is an org-less super_admin.
    let recipientOrgId: string | undefined;
    if (recipientType === 'staff') {
      const { getUserById } = await import('@/modules/identity/services/user-service');
      const user = await getUserById(body.patientId as string);
      const sameOrg = !!user && (auth.role === 'super_admin' || (!!auth.orgId && user.orgId === auth.orgId));
      if (!user || user.isActive === false || !sameOrg) {
        return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
      }
      recipientName = user.name || '';
      recipientPhone = user.phone || '';
      recipientOrgId = user.orgId;
    } else {
      const { getPatientById } = await import('@/lib/services/patient-service');
      const { filterByScope, buildScopeFromAuth } = await import('@/lib/services/data-scope');
      const patient = await getPatientById(body.patientId as string, buildScopeFromAuth(auth));
      // Missing and out-of-scope read identically (404): a 403 here would tell
      // a caller which patient ids exist in other tenants.
      if (!patient || filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
        return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      }
      recipientOrgId = patient.orgId;
      recipientName = [patient.firstName, patient.surname].filter(Boolean).join(' ');
      recipientPhone = patient.phone || '';
    }
    const { createMessage, updateMessage } = await import('@/modules/communication/services/message-service');
    // Sender facility name: the verified session or the caller's own facility
    // record -- never the request body.
    let fromHospitalName = (auth as { hospitalName?: string }).hospitalName || '';
    if (!fromHospitalName && auth.hospitalId) {
      try {
        const { getHospitalById } = await import('@/lib/services/hospital-service');
        fromHospitalName = (await getHospitalById(auth.hospitalId))?.name || '';
      } catch {
        fromHospitalName = '';
      }
    }
    const messageText = (body.content as string) || (body.body as string) || '';
    const message = await createMessage({
      patientId: body.patientId as string,
      patientName: recipientName || (body.patientName as string) || '',
      patientPhone: recipientPhone,
      recipientType,
      fromDoctorId: auth.sub,
      fromDoctorName: auth.name,
      fromHospitalName: fromHospitalName,
      subject: (body.subject as string) || '',
      body: messageText,
      channel,
      sentAt: new Date().toISOString(),
      orgId: auth.orgId ?? recipientOrgId,
    });

    // Fan out to the SMS gateway for sms/both channels. Resolve the recipient
    // phone from the canonical source (patient or staff record) before falling
    // back to whatever the caller supplied — UIs occasionally pass stale
    // patientPhone strings. The send is fire-and-forget: a slow gateway must
    // not block the API response, and a failure must not lose the message doc
    // (the app-side channel still works).
    if (channel === 'sms' || channel === 'both') {
      void (async () => {
        try {
          // Only the scoped record's number is ever used (resolved above).
          const phone = recipientPhone;
          if (!phone) {
            console.warn(`[API /messages POST] No phone for ${recipientType} ${body.patientId}; SMS skipped`);
            return;
          }
          const { sendSms } = await import('@/lib/sms');
          const result = await sendSms({ to: phone, body: messageText });
          await updateMessage(message._id, { smsResult: result }).catch(() => {
            // updateMessage already swallows DB errors and returns null.
          });
        } catch (err) {
          logApiError('[API /messages POST] SMS dispatch', err);
        }
      })();
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    logApiError('[API /messages POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'message.create' });
