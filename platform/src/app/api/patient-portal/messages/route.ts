import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { logAuditSafe } from '@/lib/services/audit-service';
import type { MessageDoc } from '@/lib/db-types';
import { validatePortalMessage } from '@/lib/patient-portal-write-validation';
import { demoFallbackEnabled, logDemoFallback, getDemoMessagesByPatient, recordDemoMessage } from '@/lib/patient-portal-demo';

/**
 * Organisation, facility and addressee for a patient's message. Ownership comes
 * from the patient's record (lib/patient-portal-ownership.ts); the addressee
 * from their existing thread. Best-effort: a failed lookup leaves the fields
 * empty and the send falls back to what it did before, rather than refusing a
 * message the patient has already typed.
 */
async function resolvePortalMessageRouting(patientId: string): Promise<{
  orgId?: string;
  hospitalId?: string;
  recipient?: { id: string; name?: string; hospitalId?: string };
}> {
  try {
    const { resolvePortalOwnership } = await import('@/lib/patient-portal-ownership');
    const { getPortalMessagesByPatient } = await import('@/modules/communication/services/message-service');
    const { resolveReplyRecipient } = await import('@/modules/communication/services/patient-thread-service');
    const [ownership, thread] = await Promise.all([
      resolvePortalOwnership(patientId),
      getPortalMessagesByPatient(patientId).catch(() => []),
    ]);
    if (!ownership.patient) return {};
    return {
      orgId: ownership.orgId,
      hospitalId: ownership.facilityId,
      recipient: resolveReplyRecipient(thread, ownership.patient),
    };
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getPortalMessagesByPatient } = await import('@/modules/communication/services/message-service');
    const { isInPatientConversation } = await import('@/modules/communication/services/patient-thread-service');
    // Only the conversation. The same database holds staff-to-staff alerts that
    // carry this patient's id — "CRITICAL: potassium for …" written by the lab
    // to the clinician — and returning everything with a matching patientId
    // showed those to the patient, before any clinician had spoken to them.
    // …and not a message staff took back: retraction keeps the text on the
    // record for staff, but a result sent to the wrong patient and withdrawn
    // must stop being shown to that patient.
    const messages = (await getPortalMessagesByPatient(auth.sub))
      .filter(message => isInPatientConversation(message) && !message.deleted);
    return NextResponse.json({ messages });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('messages', err);
      return NextResponse.json({ messages: await getDemoMessagesByPatient(auth.sub) });
    }
    logApiError('[patient-portal/messages]', err);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  // Tighter than the per-patient floor: a message lands in a clinician inbox, so this is a
  // handfuls-per-visit action and a strict cap never touches real use.
  const limited = await guardPortalWrite(auth.sub, 'portal-message', 10, 5 * 60_000);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validated = validatePortalMessage(body);
  if (!validated.ok) {
    return NextResponse.json({ error: 'Invalid message', fields: validated.fields }, { status: 400 });
  }

  // Where the message belongs comes from the patient's own record, not from
  // the request. Without an organisation the message is invisible to every
  // staff screen (tenant filtering drops it) and never replicates to a clinic
  // device — which is what happened to every portal reply before this: the
  // patient saw it sent, and nobody on the other side could.
  const routing = await resolvePortalMessageRouting(auth.sub);
  // So a message that cannot be routed is refused, not saved: "we could not
  // send that" is something the patient can act on, and silence is not. (The
  // demo build has no patient records to route by and keeps its fallback.)
  if (!routing.orgId && !demoFallbackEnabled()) {
    logApiError('[patient-portal/messages POST]', new Error(`No organisation resolved for patient ${auth.sub}`));
    return NextResponse.json({ error: 'Your message could not be delivered. Please contact your facility.' }, { status: 503 });
  }

  const name = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');

  // Patient → staff message. Direction, sender, destination and time are all
  // set here so a patient cannot impersonate a clinician, address a message to
  // a clinic or clinician of their choosing, or date it to jump the thread.
  const now = new Date().toISOString();
  const messageInput = {
    recipientType: 'staff' as const,
    direction: 'patient_to_staff' as const,
    patientId: auth.sub,
    patientName: auth.name,
    patientPhone: validated.value.patientPhone,
    // Filed where the clinician being answered can see it: a patient
    // registered at one facility and seen at another is replying to a doctor
    // scoped to the second. `fromHospitalId` keeps the registration facility,
    // so its front desk still sees the enquiry too.
    recipientHospitalId: routing.recipient?.hospitalId || routing.hospitalId
      || (typeof body.recipientHospitalId === 'string' ? body.recipientHospitalId : undefined),
    recipientHospitalName: name(body.recipientHospitalName) || name(body.fromHospitalName) || undefined,
    recipientDepartment: validated.value.department,
    recipientStaffId: routing.recipient?.id,
    recipientStaffName: routing.recipient?.name,
    orgId: routing.orgId,
    fromDoctorId: 'patient',
    fromDoctorName: auth.name,
    fromHospitalName: name(body.fromHospitalName),
    fromHospitalId: routing.hospitalId
      || (typeof body.fromHospitalId === 'string' ? body.fromHospitalId : undefined),
    subject: validated.value.subject,
    body: validated.value.body,
    channel: 'app' as const,
    // The server's clock, not the phone's: thread order and "has anyone
    // answered this" both read it, and a future date would pin a message to
    // the bottom of the thread, unanswerable, for ever.
    sentAt: now,
    createdBy: auth.sub,
  };

  try {
    const { createMessage } = await import('@/modules/communication/services/message-service');
    const doc = await createMessage(
      messageInput as Omit<MessageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'>
    );

    await logAuditSafe(
      'PATIENT_SEND_MESSAGE', auth.sub, auth.name,
      // No subject: it is the patient's own free text, and audit rows are
      // read by administrators.
      `Patient ${auth.sub} sent message ${doc._id}`,
      true,
      { orgId: routing.orgId, hospitalId: routing.hospitalId, patientId: auth.sub, resourceType: 'message', resourceId: doc._id },
    );

    return NextResponse.json({ ok: true, id: doc._id, message: doc }, { status: 201 });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('messages POST', err);
      const doc: MessageDoc = {
        _id: `msg-demo-${Date.now().toString(36)}`,
        type: 'message',
        status: 'sent',
        createdAt: now,
        updatedAt: now,
        ...messageInput,
      };
      recordDemoMessage(doc);
      return NextResponse.json({ ok: true, id: doc._id, message: doc }, { status: 201 });
    }
    logApiError('[patient-portal/messages POST]', err);
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }
}
