/**
 * API: /api/anc
 * GET  — List ANC visits (supports ?motherId=xxx&facilityId=xxx&view=stats|high-risk)
 * POST — Create a new ANC visit
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import { authorizeJson } from '@/lib/api-json-guard';
import { isContext, pickAllowed, resolveCreateContext } from '@/lib/api-create-guard';
/** Client-settable ANC contact fields. Everything else is server-owned. */
const VISIT_FIELDS = [
  'motherId', 'motherName', 'motherAge', 'gravida', 'parity', 'visitNumber', 'visitDate',
  'gestationalAge', 'facilityId', 'facilityName', 'state', 'bloodPressure', 'weight',
  'fundalHeight', 'fetalHeartRate', 'hemoglobin', 'urineProtein', 'bloodGroup', 'rhFactor',
  'hivStatus', 'malariaTest', 'syphilisTest', 'ironFolateGiven', 'tetanusVaccine', 'iptpDose',
  'riskFactors', 'riskLevel', 'birthPlan', 'nextVisitDate', 'notes',
] as const;
import { VITAL_EVENTS_REGISTER_ROLES } from '@/lib/api-capabilities';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'medical_superintendent',
  'data_entry_clerk', 'government',
  'hrio', 'nutritionist', 'front_desk',
];
const CREATE_ROLES = VITAL_EVENTS_REGISTER_ROLES;
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
    const guarded = await authorizeJson(request, CREATE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    if (!body.motherId || !body.motherName || !body.visitNumber) {
      return NextResponse.json(
        { error: 'motherId, motherName, and visitNumber are required' },
        { status: 400 }
      );
    }
    // Allow-list the clinical fields. Attribution, tenancy, the birth link,
    // soft-delete flag, ids and timestamps are server-owned.
    const visitDoc: Record<string, unknown> = { ...pickAllowed(body, VISIT_FIELDS) };
    visitDoc.attendedBy = auth.sub;
    visitDoc.attendedByRole = auth.role;
    // A mother who is a registered patient must be inside the caller's tenant
    // and facility scope. A mother not yet registered carries a device-minted
    // `mother-new-` id and has no chart to protect.
    const rawPatientId = body.patientId ?? (String(body.motherId).startsWith('mother-new-') ? undefined : body.motherId);
    if (rawPatientId !== undefined) {
      const ctx = await resolveCreateContext(auth, rawPatientId, body.facilityId);
      if (!isContext(ctx)) return ctx.response;
      visitDoc.patientId = ctx.patient._id;
      if (ctx.hospitalId) visitDoc.facilityId = ctx.hospitalId;
      if (ctx.facility?.name) visitDoc.facilityName = ctx.facility.name;
      if (ctx.orgId) visitDoc.orgId = ctx.orgId;
    } else {
      delete visitDoc.patientId;
      // No chart to derive a facility from: the caller's own facility, never the body's.
      if (auth.hospitalId) visitDoc.facilityId = auth.hospitalId;
      else delete visitDoc.facilityId;
      if (auth.orgId) visitDoc.orgId = auth.orgId;
    }
    const { createANCVisit } = await import('@/lib/services/anc-service');
    const visit = await createANCVisit(
      visitDoc as Parameters<typeof createANCVisit>[0],
      (await import('@/lib/services/data-scope')).buildScopeFromAuth(auth),
    );
    return NextResponse.json({ visit }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === 'ValidationError') {
      return NextResponse.json({ error: err.message, fields: (err as Error & { fields?: Record<string, string> }).fields }, { status: 400 });
    }
    logApiError('[API /anc POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'anc.create' });
