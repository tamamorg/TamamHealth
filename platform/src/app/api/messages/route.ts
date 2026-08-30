/**
 * API: /api/messages
 * GET  — List messages by patient or doctor
 * POST — Create, update status, or delete messages
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
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
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const doctorId = url.searchParams.get('doctorId');
    let messages;
    if (patientId) {
      messages = filterByScope(await getMessagesByPatient(patientId), scope);
    } else if (doctorId) {
      messages = filterByScope(await getMessagesByDoctor(doctorId), scope);
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
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
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
      const updated = await updateMessage(body.messageId as string, {
        status: body.status as Parameters<typeof updateMessage>[1]['status'],
      });
      if (!updated) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      return NextResponse.json({ message: updated });
    }
    // Delete message
    if (action === 'delete' && body.messageId) {
      const { deleteMessage } = await import('@/modules/communication/services/message-service');
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
      const deleted = await deleteMessage(body.messageId as string);
      if (!deleted) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }
    // Create new message
    if (!body.patientId || !body.content) {
      return NextResponse.json(
        { error: 'patientId and content are required' },
        { status: 400 }
      );
    }
    if (body.patientId && body.recipientType !== 'staff') {
      const { getPatientById } = await import('@/lib/services/patient-service');
      const { filterByScope, buildScopeFromAuth } = await import('@/lib/services/data-scope');
      const patient = await getPatientById(body.patientId as string);
      if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      if (filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
        return forbidden('Access denied to this patient record');
      }
    }
    const { createMessage, updateMessage } = await import('@/modules/communication/services/message-service');
    const channel = (body.channel as 'app' | 'sms' | 'both') || 'app';
    const messageText = (body.content as string) || (body.body as string) || '';
    const recipientType = (body.recipientType as 'patient' | 'staff') || 'patient';
    const message = await createMessage({
      patientId: body.patientId as string,
      patientName: (body.patientName as string) || '',
      patientPhone: (body.patientPhone as string) || '',
      recipientType,
      fromDoctorId: auth.sub,
      fromDoctorName: (body.fromDoctorName as string) || '',
      fromHospitalName: (body.fromHospitalName as string) || '',
      subject: (body.subject as string) || '',
      body: messageText,
      channel,
      sentAt: new Date().toISOString(),
      orgId: auth.orgId,
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
          let phone = '';
          if (recipientType === 'staff') {
            const { getUserById } = await import('@/modules/identity/services/user-service');
            const user = await getUserById(body.patientId as string);
            phone = user?.phone || (body.patientPhone as string) || '';
          } else {
            const { getPatientById } = await import('@/lib/services/patient-service');
            const patient = await getPatientById(body.patientId as string);
            phone = patient?.phone || (body.patientPhone as string) || '';
          }
          if (!phone) {
            console.warn(`[API /messages POST] No phone for ${recipientType} ${body.patientId}; SMS skipped`);
            return;
          }
          const { sendSms } = await import('@/lib/sms');
          const result = await sendSms({ to: phone, body: messageText });
          await updateMessage(message._id, { smsResult: result }).catch(() => {
            // updateMessage already swallows DB errors and returns null; the
            // catch here guards against rejections from the dynamic import
            // path itself (rare, but cheap to defend).
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
