/**
 * API: /api/billing
 * GET  — List bills (supports ?patientId=xxx&status=pending)
 * POST — Create a new bill / record a payment
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { authorizeJson } from '@/lib/api-json-guard';
import { withAuditLog } from '@/lib/audit/with-audit';
import { isContext, patientDisplayName, pickAllowed, resolveCreateContext } from '@/lib/api-create-guard';
/** Client-settable bill fields. Everything else is server-owned. */
const BILL_FIELDS = [
  'facilityLevel', 'encounterDate', 'encounterId', 'appointmentId', 'items', 'discount',
  'discountReason', 'taxRate', 'currency', 'insuranceProvider', 'insurancePolicyNumber',
  'insuranceCoveragePercent', 'state', 'county', 'notes',
] as const;
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
    const guarded = await authorizeJson(request, CREATE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    // Both by-id actions must prove the target bill is inside the caller's
    // tenant scope before mutating it — same guard as /api/referrals and
    // /api/appointments. Out-of-scope resolves to 404, not 403, so the
    // response does not confirm the bill exists.
    if (body.action === 'record_payment' || body.action === 'waive') {
      if (typeof body.billId !== 'string' || !body.billId) {
        return NextResponse.json({ error: 'billId is required' }, { status: 400 });
      }
      const { getBillById } = await import('@/lib/services/billing-service');
      const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
      const existing = await getBillById(body.billId as string, buildScopeFromAuth(auth));
      if (!existing || filterByScope([existing], buildScopeFromAuth(auth)).length === 0) {
        return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
      }
    }
    // Check if this is a payment recording action
    if (body.action === 'record_payment') {
      const { recordPayment, isPaymentMethod, BillingError } = await import('@/lib/services/billing-service');
      if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
        return NextResponse.json({ error: 'amount must be a number greater than zero' }, { status: 400 });
      }
      if (!isPaymentMethod(body.method)) {
        return NextResponse.json({ error: 'method is not a recognised payment method' }, { status: 400 });
      }
      if (body.reference !== undefined && typeof body.reference !== 'string') {
        return NextResponse.json({ error: 'reference must be a string' }, { status: 400 });
      }
      if (body.notes !== undefined && typeof body.notes !== 'string') {
        return NextResponse.json({ error: 'notes must be a string' }, { status: 400 });
      }
      try {
        const result = await recordPayment(
          body.billId as string,
          body.amount,
          body.method,
          auth.sub,
          auth.name,
          body.reference as string | undefined,
          body.notes as string | undefined,
        );
        if (!result) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
        return NextResponse.json({ bill: result });
      } catch (err) {
        if (err instanceof BillingError) {
          const status = err.code === 'INVALID_AMOUNT' || err.code === 'INVALID_METHOD' ? 400 : 409;
          return NextResponse.json({ error: err.message, code: err.code }, { status });
        }
        throw err;
      }
    }

    // Check if this is a waiver action
    if (body.action === 'waive') {
      const { waiveBill, BillingError } = await import('@/lib/services/billing-service');
      if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500)) {
        return NextResponse.json({ error: 'reason must be a string of at most 500 characters' }, { status: 400 });
      }
      // Separation of duties: a second person approves, with their own
      // password, checked here. The signed-in user cannot approve their own.
      const approver = body.approver as { username?: unknown; password?: unknown } | undefined;
      if (typeof approver?.username !== 'string' || typeof approver?.password !== 'string' || !approver.username || !approver.password) {
        return NextResponse.json({ error: 'Waiver not recorded. A manager must approve it with their own username and password.', code: 'APPROVER_REQUIRED' }, { status: 400 });
      }
      const { verifyManagerOverride } = await import('@/lib/services/manager-override-service');
      const override = await verifyManagerOverride({
        username: approver.username, password: approver.password, purpose: `waiver of bill ${String(body.billId).slice(0, 64)}`,
        requester: { sub: auth.sub, username: auth.username, name: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId },
      });
      if (!override.ok) {
        return NextResponse.json({ error: override.message, code: override.code }, { status: override.code === 'BAD_CREDENTIALS' ? 422 : 403 });
      }
      try {
        const result = await waiveBill(
          body.billId as string,
          auth.sub,
          auth.name,
          (typeof body.reason === 'string' && body.reason.trim()) || 'Fee waiver',
          override.approval,
        );
        if (!result) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
        return NextResponse.json({ bill: result });
      } catch (err) {
        if (err instanceof BillingError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === 'INVALID_REASON' ? 400 : 409 });
        }
        throw err;
      }
    }

    // Create new bill
    if (!body.patientId || !body.items) {
      return NextResponse.json(
        { error: 'patientId and items are required' },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.items) || body.items.some((it) => {
      const line = it as Record<string, unknown> | null;
      return !line || typeof line !== 'object'
        || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0
        || typeof line.unitPrice !== 'number' || !Number.isFinite(line.unitPrice) || line.unitPrice < 0;
    })) {
      return NextResponse.json({ error: 'Each bill item needs a quantity above zero and a price of zero or more' }, { status: 400 });
    }
    // Money fields are bounded. A discount that clears the whole bill is a
    // waiver and must go through the audited `waive` action; a larger one
    // would make a negative total. taxRate is a percentage (see calculateTotals).
    const subtotal = (body.items as Array<{ quantity: number; unitPrice: number }>)
      .reduce((sum, it) => sum + Math.round(it.quantity * it.unitPrice * 100) / 100, 0);
    if (body.discount !== undefined && body.discount !== null) {
      if (typeof body.discount !== 'number' || !Number.isFinite(body.discount) || body.discount < 0) {
        return NextResponse.json({ error: 'discount must be a number of zero or more' }, { status: 400 });
      }
      if (body.discount > 0 && body.discount >= subtotal) {
        return NextResponse.json({ error: 'discount must be less than the bill subtotal. To clear the whole bill, use the waive action.' }, { status: 400 });
      }
    }
    if (body.taxRate !== undefined && body.taxRate !== null
      && (typeof body.taxRate !== 'number' || !Number.isFinite(body.taxRate) || body.taxRate < 0 || body.taxRate > 100)) {
      return NextResponse.json({ error: 'taxRate must be a percentage between 0 and 100' }, { status: 400 });
    }
    if (body.insuranceCoveragePercent !== undefined && body.insuranceCoveragePercent !== null
      && (typeof body.insuranceCoveragePercent !== 'number' || !Number.isFinite(body.insuranceCoveragePercent)
        || body.insuranceCoveragePercent < 0 || body.insuranceCoveragePercent > 100)) {
      return NextResponse.json({ error: 'insuranceCoveragePercent must be a percentage between 0 and 100' }, { status: 400 });
    }
    // The patient must exist inside the caller's tenant and facility scope;
    // org, facility and the patient's identity come from the session and chart.
    const ctx = await resolveCreateContext(auth, body.patientId, body.facilityId);
    if (!isContext(ctx)) return ctx.response;
    // Allow-list. `exemptReason` is NOT accepted: it creates a pre-waived,
    // zero-balance bill, and a waiver goes through the `waive` action (which
    // records who and why). Attribution, ids and timestamps are server-owned.
    const bill0: Record<string, unknown> = {
      ...pickAllowed(body, BILL_FIELDS),
      patientId: ctx.patient._id,
      patientName: patientDisplayName(ctx.patient),
      hospitalNumber: ctx.patient.hospitalNumber,
      generatedBy: auth.sub,
      generatedByName: auth.name,
    };
    if (ctx.hospitalId) bill0.facilityId = ctx.hospitalId;
    if (ctx.facility?.name) bill0.facilityName = ctx.facility.name;
    if (ctx.facility?.facilityLevel) bill0.facilityLevel = ctx.facility.facilityLevel;
    if (ctx.orgId) bill0.orgId = ctx.orgId;
    const { createBill } = await import('@/lib/services/billing-service');
    const bill = await createBill(bill0 as unknown as Parameters<typeof createBill>[0]);
    return NextResponse.json({ bill }, { status: 201 });
  } catch (err) {
    logApiError('[API /billing POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'billing.create' });
