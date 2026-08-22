/**
 * API: /api/prescriptions
 * GET  — List prescriptions (supports ?patientId=xxx&status=pending)
 * POST — Create a new prescription
 */
import { CLINICIANS } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, validationError, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'pharmacist', 'medical_superintendent',
];
const CREATE_ROLES = CLINICIANS;
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllPrescriptions, getPrescriptionsByPatient } = await import('@/lib/services/prescription-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    let prescriptions;
    const scope = buildScopeFromAuth(auth);
    if (patientId) {
      prescriptions = await getPrescriptionsByPatient(patientId, scope);
    } else {
      prescriptions = await getAllPrescriptions(scope);
    }
    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a clinician's list view into an error.
    import('@/lib/services/audit-service').then(({ logPhiSearch }) =>
      logPhiSearch(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/prescriptions' },
        'prescription',
        { query: new URL(request.url).searchParams.get('q') || undefined, resultCount: Array.isArray(prescriptions) ? prescriptions.length : 0 },
      ),
    ).catch(() => {});
    return NextResponse.json({ prescriptions, total: prescriptions.length });
  } catch (err) {
    logApiError('[API /prescriptions GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'prescriptions:write', 30);
    if (rateLimitResponse) return rateLimitResponse;
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
    if (!body.prescribedBy) body.prescribedBy = auth.name;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client — see the matching comment in /api/referrals for the rationale.
    if (auth.orgId) {
      body.orgId = auth.orgId;
    } else if (!(auth.role === 'super_admin' || auth.role === 'government')) {
      delete body.orgId;
    }
    if (!body.hospitalId && auth.hospitalId) body.hospitalId = auth.hospitalId;
    const { createPrescription } = await import('@/lib/services/prescription-service');
    const result = await createPrescription(body as Parameters<typeof createPrescription>[0]);
    return NextResponse.json({
      prescription: result.prescription,
      interactionWarnings: result.interactionWarnings,
    }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ValidationError') {
      const ve = err as Error & { fields: Record<string, string> };
      return validationError(ve.fields);
    }
    // Facility policy refused the order (allergy hard stop). That is a
    // deliberate answer, not a server fault — 409 with the reason, so an
    // integration or the mobile client can show the prescriber why.
    if (err instanceof Error && err.name === 'AllergyHardStopError') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    logApiError('[API /prescriptions POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'prescription.create' });
