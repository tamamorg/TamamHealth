/**
 * API: /api/lab
 * GET  — List lab results (supports ?status=pending&patientId=xxx)
 * POST — Create a new lab order
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import { authorizeJson } from '@/lib/api-json-guard';
import { isContext, patientDisplayName, pickAllowed, resolveCreateContext } from '@/lib/api-create-guard';
/** Client-settable requisition fields. Everything else on a lab order is server-owned. */
const ORDER_FIELDS = [
  'testName', 'specimen', 'tier', 'encounterId', 'orderKind', 'clinicalNotes', 'orderComment',
  'priority', 'indications', 'aoeAnswers', 'fasting', 'collectionTiming', 'scheduledCollectionAt',
  'processing', 'orderGroupId', 'requestSource', 'externalFacility', 'externalRequester',
  'externalReference', 'specimenCollectedOutside',
  'modality', 'bodyRegion', 'laterality', 'contrast', 'studyScheduledAt', 'safetyChecks',
] as const;
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'lab_tech', 'medical_superintendent', 'radiologist',
];
const CREATE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'lab_tech',
  'medical_superintendent',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllLabResults, getLabResultsByPatient, getPendingLabResults } = await import('@/lib/services/lab-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    // One scope for every branch. The `status=pending` branch used to call
    // getPendingLabResults() bare, which reads the whole database — the local
    // store holds every organisation's rows, so that returned other tenants'
    // orders (decrypted, with clinical notes) to any caller holding a lab role.
    const scope = buildScopeFromAuth(auth);
    let results;
    if (patientId) {
      const rows = await getLabResultsByPatient(patientId);
      results = filterByScope(rows, scope);
    } else if (status === 'pending') {
      results = await getPendingLabResults(scope);
    } else {
      results = await getAllLabResults(scope);
    }
    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a clinician's list view into an error.
    import('@/lib/services/audit-service').then(({ logPhiSearch }) =>
      logPhiSearch(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/lab' },
        'lab_result',
        { query: new URL(request.url).searchParams.get('q') || undefined, resultCount: Array.isArray(results) ? results.length : 0 },
      ),
    ).catch(() => {});
    return NextResponse.json({ labResults: results, total: results.length });
  } catch (err) {
    logApiError('[API /lab GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const guarded = await authorizeJson(request, CREATE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    // Validate required fields
    if (!body.patientId || !body.testName) {
      return NextResponse.json(
        { error: 'patientId and testName are required' },
        { status: 400 }
      );
    }
    // The patient must exist inside the caller's tenant and facility scope, and
    // orgId / facility / patient identity come from the session and the chart.
    const ctx = await resolveCreateContext(auth, body.patientId, body.hospitalId);
    if (!isContext(ctx)) return ctx.response;
    const now = new Date().toISOString();
    // Allow-list: the requisition. Status, result values, flags, attribution,
    // timestamps and ids are server-owned -- an order always starts pending
    // and empty, so a body cannot mint a "completed" or "critical" result.
    const order: Record<string, unknown> = {
      ...pickAllowed(body, ORDER_FIELDS),
      patientId: ctx.patient._id,
      patientName: patientDisplayName(ctx.patient),
      hospitalNumber: ctx.patient.hospitalNumber || '',
      status: 'pending',
      orderStatus: 'ordered',
      result: '',
      unit: '',
      referenceRange: '',
      abnormal: false,
      critical: false,
      orderedBy: auth.name,
      orderedById: auth.sub,
      orderedAt: now,
      completedAt: '',
    };
    if (ctx.orgId) order.orgId = ctx.orgId;
    if (ctx.hospitalId) order.hospitalId = ctx.hospitalId;
    if (ctx.facility?.name) order.hospitalName = ctx.facility.name;
    const { createLabResult } = await import('@/lib/services/lab-service');
    const result = await createLabResult(order as Parameters<typeof createLabResult>[0]);
    return NextResponse.json({ labResult: result }, { status: 201 });
  } catch (err) {
    logApiError('[API /lab POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'lab.create' });
