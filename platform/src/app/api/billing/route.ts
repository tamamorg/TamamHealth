/**
 * API: /api/billing
 * GET  — List bills (supports ?patientId=xxx&status=pending)
 * POST — Create a new bill / record a payment
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer',
  'cashier', 'medical_superintendent', 'medical_biller', 'hospital_manager',
];
const CREATE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'cashier', 'medical_superintendent', 'medical_biller',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllBills, getBillsByPatient, getUnpaidBills, getBillingSummary } = await import('@/lib/services/billing-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    const summary = url.searchParams.get('summary');
    if (summary === 'true') {
      const scope = buildScopeFromAuth(auth);
      const stats = await getBillingSummary(scope);
      return NextResponse.json(stats);
    }
    let bills;
    if (patientId) {
      // Scoped inside getBillsByPatient itself now — a patient can have
      // bills in more than one org, and this is a staff request (unlike the
      // patient-portal route), so it must never see another org's bill.
      bills = await getBillsByPatient(patientId, buildScopeFromAuth(auth));
    } else if (status === 'unpaid') {
      const scope = buildScopeFromAuth(auth);
      bills = await getUnpaidBills(scope);
    } else {
      const scope = buildScopeFromAuth(auth);
      bills = await getAllBills(scope);
    }
    return NextResponse.json({ bills, total: bills.length });
  } catch (err) {
    logApiError('[API /billing GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, CREATE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    // Both by-id actions must prove the target bill is inside the caller's
    // tenant scope before mutating it — same guard as /api/referrals and
    // /api/appointments. Out-of-scope resolves to 404, not 403, so the
    // response does not confirm the bill exists.
    if (body.action === 'record_payment' || body.action === 'waive') {
      const { getBillById } = await import('@/lib/services/billing-service');
      const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
      const existing = await getBillById(body.billId as string);
      if (!existing || filterByScope([existing], buildScopeFromAuth(auth)).length === 0) {
        return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
      }
    }
    // Check if this is a payment recording action
    if (body.action === 'record_payment') {
      const { recordPayment } = await import('@/lib/services/billing-service');
      const result = await recordPayment(
        body.billId as string,
        body.amount as number,
        body.method as Parameters<typeof recordPayment>[2],
        auth.sub,
        auth.name,
        body.reference as string | undefined,
        body.notes as string | undefined,
      );
      if (!result) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
      return NextResponse.json({ bill: result });
    }
    // Check if this is a waiver action
    if (body.action === 'waive') {
      const { waiveBill } = await import('@/lib/services/billing-service');
      const result = await waiveBill(
        body.billId as string,
        auth.sub,
        auth.name,
        (body.reason as string) || 'Fee waiver',
      );
      if (!result) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
      return NextResponse.json({ bill: result });
    }
    // Create new bill
    if (!body.patientId || !body.items) {
      return NextResponse.json(
        { error: 'patientId and items are required' },
        { status: 400 }
      );
    }
    body.generatedBy = auth.sub;
    body.generatedByName = auth.name;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client — see the matching comment in /api/referrals for the rationale.
    if (auth.orgId) {
      body.orgId = auth.orgId;
    } else if (!(auth.role === 'super_admin' || auth.role === 'government')) {
      delete body.orgId;
    }
    const { createBill } = await import('@/lib/services/billing-service');
    const bill = await createBill(body as unknown as Parameters<typeof createBill>[0]);
    return NextResponse.json({ bill }, { status: 201 });
  } catch (err) {
    logApiError('[API /billing POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'billing.create' });
