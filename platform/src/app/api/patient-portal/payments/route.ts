import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { paymentsDB } from '@/lib/db';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import type { PaymentDoc, PaymentStatus, PaymentMethodType } from '@/lib/db-types-payments';
import { validatePortalPayment, portalDocId } from '@/lib/patient-portal-write-validation';

export async function POST(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  // Tighter than the per-patient floor: each POST records a pending payment row, so this is a
  // handfuls-per-visit action and a strict cap never touches real use.
  const limited = await guardPortalWrite(auth.sub, 'portal-payment', 10, 5 * 60_000);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Finance control: patient-submitted payments land in 'pending' and MUST be
  // reviewed/approved before being posted to the ledger. Do not auto-allocate.
  try {
    const now = new Date().toISOString();
    const id = portalDocId(body._id, 'pmt', uuidv4);

    const validated = validatePortalPayment(body);
    if (!validated.ok) {
      return NextResponse.json({ error: 'Invalid payment', fields: validated.fields }, { status: 400 });
    }
    const db = paymentsDB();

    // A payment is filed under the patient's own organisation, at a facility
    // of that organisation — the one named when it is one, else the patient's
    // registration facility — so finance at that clinic can see it to approve
    // it. It is never filed under another organisation: that would put an
    // unverified payment, with a reference of the patient's choosing, into a
    // finance queue that has no reason to distrust it. See
    // lib/patient-portal-ownership.ts.
    const { resolvePortalOwnership, missingOwnership } = await import('@/lib/patient-portal-ownership');
    const ownership = await resolvePortalOwnership(
      auth.sub, typeof body.facilityId === 'string' ? body.facilityId : undefined,
    );
    if (ownership.foreignFacility) {
      return NextResponse.json(
        { error: 'Invalid payment', fields: { facilityId: 'This facility cannot be paid from your portal.' } },
        { status: 400 },
      );
    }
    if (missingOwnership(ownership)) {
      logApiError('[patient-portal/payments POST]', new Error(`No organisation resolved for patient ${auth.sub}`));
      return NextResponse.json({ error: 'Your payment could not be submitted. Please contact your facility.' }, { status: 503 });
    }

    const doc: PaymentDoc = {
      _id: id,
      type: 'payment',
      orgId: ownership.orgId,
      patientId: auth.sub,
      patientName: auth.name,
      encounterId: typeof body.encounterId === 'string' ? body.encounterId : undefined,
      invoiceId: typeof body.invoiceId === 'string' ? body.invoiceId : undefined,
      method: validated.value.method as PaymentMethodType,
      amount: validated.value.amount,
      currency: validated.value.currency,
      reference: typeof body.reference === 'string' ? body.reference : undefined,
      mobileMoneyPhone: typeof body.mobileMoneyPhone === 'string' ? body.mobileMoneyPhone : undefined,
      status: 'pending' as PaymentStatus,
      processedAt: typeof body.processedAt === 'string' ? body.processedAt : now,
      processedBy: auth.sub,
      processedByName: auth.name,
      notes: `[PATIENT_SUBMITTED] pending_verification — finance must approve before posting. ${typeof body.notes === 'string' ? body.notes : ''}`.trim(),
      facilityId: ownership.facilityId || '',
      createdAt: now,
      updatedAt: now,
      createdBy: auth.sub,
    };

    const resp = await db.put(doc);
    doc._rev = resp.rev;

    await logAuditSafe(
      'PATIENT_SUBMIT_PAYMENT', auth.sub, auth.name,
      `Patient ${auth.sub} submitted payment ${doc._id} for ${doc.amount} ${doc.currency} (pending finance approval)`,
      true,
      { orgId: doc.orgId, hospitalId: doc.facilityId, patientId: auth.sub, resourceType: 'payment', resourceId: doc._id },
    );
    emitSyncEvent({
      resourceType: 'payment',
      resourceId: doc._id,
      operation: 'create',
      resourceVersion: doc._rev,
      userId: auth.sub,
      username: auth.name,
      hospitalId: doc.facilityId,
    });

    return NextResponse.json({ ok: true, id: doc._id }, { status: 201 });
  } catch (err) {
    logApiError('[patient-portal/payments POST]', err);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
