/**
 * API: /api/births
 * GET  — List births (supports ?motherId=xxx, ?patientId=xxx, ?state=xxx)
 * POST — Register a new birth
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { authorizeJson } from '@/lib/api-json-guard';
import { isContext, pickAllowed, resolveCreateContext, resolveRegisterFacility } from '@/lib/api-create-guard';
import { VITAL_EVENTS_READ_ROLES as READ_ROLES, VITAL_EVENTS_REGISTER_ROLES as WRITE_ROLES } from '@/lib/api-capabilities';
/**
 * Client-settable birth fields. Void state, attribution, tenancy, ids and
 * timestamps are server-owned. `facilityId`, the linked patient ids and
 * `orgId` (cross-org roles only) are checked below before use.
 */
const BIRTH_FIELDS = [
  'childFirstName', 'childSurname', 'childGender', 'dateOfBirth', 'placeOfBirth',
  'motherName', 'motherAge', 'motherNationality', 'fatherName', 'fatherNationality',
  'birthWeight', 'birthType', 'deliveryType', 'attendedBy', 'state', 'county',
  'certificateNumber', 'childPatientId', 'motherPatientId', 'linkedAncMotherId',
] as const;
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllBirths, getBirthsByState, getBirthStats,
    } = await import('@/lib/services/birth-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const motherId = url.searchParams.get('motherId');
    const patientId = url.searchParams.get('patientId');
    const state = url.searchParams.get('state');
    const includeStats = url.searchParams.get('stats') === 'true';
    const scope = buildScopeFromAuth(auth);
    let births;
    if (motherId) {
      // motherId query — scope-filtered births by motherPatientId
      const all = await getAllBirths(scope);
      births = all.filter(b => b.motherPatientId === motherId);
    } else if (patientId) {
      // patientId query — scope-filtered births by child patient
      const all = await getAllBirths(scope);
      births = all.filter(b => b.childPatientId === patientId);
    } else if (state) {
      // state query — `getBirthsByState` does not accept a scope, so we
      // re-apply the tenant filter via scope-aware getAllBirths to honor
      // org / hospital boundaries.
      const all = await getAllBirths(scope);
      births = all.filter(b => b.state === state);
      // Fall back to the dedicated state lookup for super_admin/government,
      // which see everything anyway.
      if (auth.role === 'super_admin' || auth.role === 'government') {
        births = await getBirthsByState(state);
      }
    } else {
      // default: all births with scope
      births = await getAllBirths(scope);
    }
    const response: Record<string, unknown> = { births, total: births.length };
    if (includeStats) {
      response.stats = await getBirthStats(scope);
    }
    return NextResponse.json(response);
  } catch (err) {
    logApiError('[API /births GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const guarded = await authorizeJson(request, WRITE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    // Validate required fields
    if (!body.childFirstName || !body.childSurname || !body.motherName || !body.dateOfBirth) {
      return NextResponse.json(
        { error: 'childFirstName, childSurname, motherName, and dateOfBirth are required' },
        { status: 400 }
      );
    }
    const data: Record<string, unknown> = pickAllowed(body, BIRTH_FIELDS);
    // A linked patient must be inside the caller's tenant and facility scope.
    for (const key of ['motherPatientId', 'childPatientId'] as const) {
      if (data[key] === undefined || data[key] === null || data[key] === '') { delete data[key]; continue; }
      const ctx = await resolveCreateContext(auth, data[key], undefined);
      if (!isContext(ctx)) return ctx.response;
      data[key] = ctx.patient._id;
    }
    // The ANC link is kept by the service only when it resolves to an ANC record in this org.
    if (typeof data.linkedAncMotherId !== 'string' || !data.linkedAncMotherId) delete data.linkedAncMotherId;
    // Facility: the caller's own, or another one they are entitled to in the same org.
    const fac = await resolveRegisterFacility(auth, body.facilityId);
    if ('response' in fac) return fac.response;
    if (fac.hospitalId) data.facilityId = fac.hospitalId;
    if (fac.facility?.name) data.facilityName = fac.facility.name;
    if (fac.facility?.state) data.state = fac.facility.state;
    // Attribution is stamped from the verified auth claim, never trusted from
    // the client: the person recorded as having made this record cannot be forged.
    data.registeredBy = auth.sub;
    data.registeredByName = auth.name;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client. Platform/national admins may still target a specific org explicitly.
    if (auth.role === 'super_admin' || auth.role === 'government') {
      if (typeof body.orgId === 'string' && body.orgId) data.orgId = body.orgId;
    } else if (auth.orgId) {
      data.orgId = auth.orgId;
    }
    const { createBirth } = await import('@/lib/services/birth-service');
    const birth = await createBirth(
      data as unknown as Parameters<typeof createBirth>[0],
      (await import('@/lib/services/data-scope')).buildScopeFromAuth(auth),
    );
    return NextResponse.json({ birth }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === 'ValidationError') {
      return NextResponse.json({ error: err.message, fields: (err as Error & { fields?: Record<string, string> }).fields }, { status: 400 });
    }
    logApiError('[API /births POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'birth.create' });
