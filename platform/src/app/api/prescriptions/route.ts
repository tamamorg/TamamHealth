/**
 * API: /api/prescriptions
 * GET  — List prescriptions (supports ?patientId=xxx&status=pending)
 * POST — Create a new prescription
 */
import { CLINICIANS } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized, validationError } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import { authorizeJson } from '@/lib/api-json-guard';
import { isContext, patientDisplayName, pickAllowed, resolveCreateContext } from '@/lib/api-create-guard';
/** Client-settable prescription fields. Everything else is server-owned. */
const ORDER_FIELDS = [
  'medication', 'dose', 'route', 'frequency', 'duration', 'indication',
  'allowSubstitution', 'refills', 'effectiveOn', 'pharmacyInstructions', 'fulfilment',
  'criticalityTier', 'offFormularyReason', 'encounterId', 'medicalRecordId',
  'quantityToDispense', 'urgency',
  // admissionId is deliberately absent: the service resolves the patient's own
  // active admission, and a body id could point at another tenant's ward.
] as const;
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
    const guarded = await authorizeJson(request, CREATE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    // The patient must exist inside the caller's tenant and facility scope.
    const ctx = await resolveCreateContext(auth, body.patientId, body.hospitalId);
    if (!isContext(ctx)) return ctx.response;
    // Allow-list the order. Status and lifecycle (status, orderStatus), the
    // dispensing/administration record, safety assessment, prescriber
    // attribution, ids and timestamps are all server-owned.
    const order: Record<string, unknown> = {
      ...pickAllowed(body, ORDER_FIELDS),
      patientId: ctx.patient._id,
      patientName: patientDisplayName(ctx.patient),
      status: 'pending',
      prescribedBy: auth.name,
    };
    if (body.medicationSafetyAcknowledgement && typeof body.medicationSafetyAcknowledgement === 'object') {
      const ack = body.medicationSafetyAcknowledgement as Record<string, unknown>;
      // Who reviewed it is the signed-in prescriber, not a name from the body.
      order.medicationSafetyAcknowledgement = {
        reviewedBy: auth.name,
        reason: typeof ack.reason === 'string' ? ack.reason : '',
      };
    }
    if (ctx.orgId) order.orgId = ctx.orgId;
    if (ctx.hospitalId) order.hospitalId = ctx.hospitalId;
    if (ctx.facility?.name) order.hospitalName = ctx.facility.name;
    const { createPrescription } = await import('@/lib/services/prescription-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const result = await createPrescription(order as Parameters<typeof createPrescription>[0], buildScopeFromAuth(auth));
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
