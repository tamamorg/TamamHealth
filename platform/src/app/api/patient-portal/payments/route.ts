import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { paymentsDB } from '@/lib/db';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import type { PaymentDoc, PaymentStatus, PaymentMethodType } from '@/lib/db-types-payments';

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
    const db = paymentsDB();
    const now = new Date().toISOString();
    const id = (typeof body._id === 'string' && body._id) || `pmt-${uuidv4()}`;

    const rawAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;

    const doc: PaymentDoc = {
      _id: id,
      type: 'payment',
      patientId: auth.sub,
      patientName: auth.name,
      encounterId: typeof body.encounterId === 'string' ? body.encounterId : undefined,
      invoiceId: typeof body.invoiceId === 'string' ? body.invoiceId : undefined,
      method: (typeof body.method === 'string' ? body.method : 'mobile_money') as PaymentMethodType,
      amount,
      currency: typeof body.currency === 'string' ? body.currency : 'SSP',
      reference: typeof body.reference === 'string' ? body.reference : undefined,
      mobileMoneyPhone: typeof body.mobileMoneyPhone === 'string' ? body.mobileMoneyPhone : undefined,
      status: 'pending' as PaymentStatus,
      processedAt: typeof body.processedAt === 'string' ? body.processedAt : now,
      processedBy: auth.sub,
      processedByName: auth.name,
      notes: `[PATIENT_SUBMITTED] pending_verification — finance must approve before posting. ${typeof body.notes === 'string' ? body.notes : ''}`.trim(),
      facilityId: typeof body.facilityId === 'string' ? body.facilityId : '',
      createdAt: now,
      updatedAt: now,
      createdBy: auth.sub,
    };

    const resp = await db.put(doc);
    doc._rev = resp.rev;

    await logAuditSafe(
      'PATIENT_SUBMIT_PAYMENT', auth.sub, auth.name,
      `Patient ${auth.sub} submitted payment ${doc._id} for ${doc.amount} ${doc.currency} (pending finance approval)`
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
    console.error('[patient-portal/payments POST]', err);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
