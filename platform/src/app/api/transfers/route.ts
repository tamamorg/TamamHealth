/**
 * API: /api/transfers
 * GET  — Assemble transfer package for a patient
 * POST — Record an action against an in-flight transfer/referral. Body shape:
 *   { action: 'acknowledge' | 'note' | 'status', referralId: string, ... }
 * Wraps the existing referral-service mutations so receiving facilities can
 * confirm hand-off without coupling the UI to the lower-level CRUD endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    if (!patientId) {
      return NextResponse.json(
        { error: 'patientId query parameter is required' },
        { status: 400 }
      );
    }
    // Tenant guard: the transfer package aggregates the ENTIRE chart (demographics,
    // all medical records, labs, attachments). Verify the caller's org/facility
    // can actually see this patient before assembling it — otherwise any clinician
    // could pull any patient's full dossier by id (cross-tenant IDOR).
    const { getPatientById } = await import('@/lib/services/patient-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const patient = await getPatientById(patientId);
    if (!patient) {
      return NextResponse.json({ error: `Patient ${patientId} not found` }, { status: 404 });
    }
    if (filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('This patient is outside your facility or organization.');
    }
    const { assembleTransferPackage } = await import('@/lib/services/transfer-service');
    let transferPackage;
    try {
      transferPackage = await assembleTransferPackage(patientId, auth.sub);
    } catch (err) {
      // Service signals missing patient by throwing `Patient <id> not found`.
      // Translate that into a 404 so callers can distinguish "no such patient"
      // from a genuine server fault. Any other throw still surfaces as 500.
      if (err instanceof Error && /not found/i.test(err.message)) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      throw err;
    }
    return NextResponse.json({ transferPackage });
  } catch (err) {
    logApiError('[API /transfers GET]', err);
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
    const action = String(body.action || '').toLowerCase();
    const referralId = typeof body.referralId === 'string' ? body.referralId : '';
    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }
    if (!referralId) {
      return NextResponse.json({ error: 'referralId is required' }, { status: 400 });
    }
    const svc = await import('@/lib/services/referral-service');
    switch (action) {
      case 'acknowledge': {
        // Receiving facility confirms transfer received → mark accepted.
        const updated = await svc.acceptReferral(referralId);
        if (!updated) return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
        return NextResponse.json({ ok: true, referral: updated });
      }
      case 'status': {
        const status = typeof body.status === 'string' ? body.status : '';
        if (!status) return NextResponse.json({ error: 'status is required' }, { status: 400 });
        const updated = await svc.updateReferralStatus(referralId, status as Parameters<typeof svc.updateReferralStatus>[1]);
        if (!updated) return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
        return NextResponse.json({ ok: true, referral: updated });
      }
      case 'note': {
        const notes = typeof body.notes === 'string' ? body.notes : '';
        if (!notes.trim()) return NextResponse.json({ error: 'notes is required' }, { status: 400 });
        const updated = await svc.updateReferralNotes(referralId, notes);
        if (!updated) return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
        return NextResponse.json({ ok: true, referral: updated });
      }
      default:
        return NextResponse.json(
          { error: `Unsupported action "${action}". Supported: acknowledge, status, note.` },
          { status: 400 },
        );
    }
  } catch (err) {
    logApiError('[API /transfers POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'transfer.create' });
