/**
 * API: /api/anc
 * GET  — List ANC visits (supports ?motherId=xxx&facilityId=xxx&view=stats|high-risk)
 * POST — Create a new ANC visit
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'medical_superintendent',
  'data_entry_clerk', 'government',
  'hrio', 'nutritionist', 'front_desk',
];
const CREATE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
  'medical_superintendent', 'data_entry_clerk',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllANCVisits, getByMother, getByFacility,
      getANCStats, getHighRiskPregnancies,
    } = await import('@/lib/services/anc-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const motherId = url.searchParams.get('motherId');
    const facilityId = url.searchParams.get('facilityId');
    const view = url.searchParams.get('view');
    if (view === 'stats') {
      const stats = await getANCStats(scope);
      return NextResponse.json(stats);
    }
    if (view === 'high-risk') {
      const highRisk = await getHighRiskPregnancies(scope);
      return NextResponse.json({ visits: highRisk, total: highRisk.length });
    }
    let visits;
    if (motherId) {
      const rows = await getByMother(motherId);
      visits = filterByScope(rows, scope);
    } else if (facilityId) {
      const rows = await getByFacility(facilityId);
      visits = filterByScope(rows, scope);
    } else {
      visits = await getAllANCVisits(scope);
    }
    return NextResponse.json({ visits, total: visits.length });
  } catch (err) {
    logApiError('[API /anc GET]', err);
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
    if (!body.motherId || !body.motherName || !body.visitNumber) {
      return NextResponse.json(
        { error: 'motherId, motherName, and visitNumber are required' },
        { status: 400 }
      );
    }
    body.attendedBy = body.attendedBy || auth.sub;
    body.attendedByRole = body.attendedByRole || auth.role;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) body.orgId = auth.orgId;
      else delete body.orgId;
    }
    const { createANCVisit } = await import('@/lib/services/anc-service');
    const visit = await createANCVisit(body as Parameters<typeof createANCVisit>[0]);
    return NextResponse.json({ visit }, { status: 201 });
  } catch (err) {
    logApiError('[API /anc POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'anc.create' });
