import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { logAuditSafe } from '@/lib/services/audit-service';
import type { MessageDoc } from '@/lib/db-types';
import { demoFallbackEnabled, logDemoFallback, getDemoMessagesByPatient, recordDemoMessage } from '@/lib/patient-portal-demo';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getPortalMessagesByPatient } = await import('@/modules/communication/services/message-service');
    const messages = await getPortalMessagesByPatient(auth.sub);
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

  // Patient → staff message. Direction + sender are forced server-side so a
  // patient cannot impersonate a clinician via the mobile push.
  const now = new Date().toISOString();
  const messageInput = {
    recipientType: 'staff' as const,
    direction: 'patient_to_staff' as const,
    patientId: auth.sub,
    patientName: auth.name,
    patientPhone: typeof body.patientPhone === 'string' ? body.patientPhone : '',
    recipientHospitalId: typeof body.recipientHospitalId === 'string' ? body.recipientHospitalId : undefined,
    recipientHospitalName: typeof body.recipientHospitalName === 'string' ? body.recipientHospitalName
      : (typeof body.fromHospitalName === 'string' ? body.fromHospitalName : undefined),
    fromDoctorId: 'patient',
    fromDoctorName: auth.name,
    fromHospitalName: typeof body.fromHospitalName === 'string' ? body.fromHospitalName : '',
    fromHospitalId: typeof body.fromHospitalId === 'string' ? body.fromHospitalId : undefined,
    subject: typeof body.subject === 'string' ? body.subject : '(no subject)',
    body: typeof body.body === 'string' ? body.body : '',
    channel: 'app' as const,
    sentAt: typeof body.sentAt === 'string' ? body.sentAt : now,
    createdBy: auth.sub,
  };

  try {
    const { createMessage } = await import('@/modules/communication/services/message-service');
    const doc = await createMessage(
      messageInput as Omit<MessageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'>
    );

    await logAuditSafe(
      'PATIENT_SEND_MESSAGE', auth.sub, auth.name,
      `Patient ${auth.sub} sent message ${doc._id} — ${doc.subject}`
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
