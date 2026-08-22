/**
 * API: /api/lab
 * GET  — List lab results (supports ?status=pending&patientId=xxx)
 * POST — Create a new lab order
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
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
    // Validate required fields
    if (!body.patientId || !body.testName) {
      return NextResponse.json(
        { error: 'patientId and testName are required' },
        { status: 400 }
      );
    }
    if (!body.orderedBy) body.orderedBy = auth.name;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client — see the matching comment in /api/referrals for the rationale.
    if (auth.orgId) {
      body.orgId = auth.orgId;
    } else if (!(auth.role === 'super_admin' || auth.role === 'government')) {
      delete body.orgId;
    }
    if (!body.hospitalId && auth.hospitalId) body.hospitalId = auth.hospitalId;
    const { createLabResult } = await import('@/lib/services/lab-service');
    const result = await createLabResult(body as Parameters<typeof createLabResult>[0]);
    return NextResponse.json({ labResult: result }, { status: 201 });
  } catch (err) {
    logApiError('[API /lab POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'lab.create' });
