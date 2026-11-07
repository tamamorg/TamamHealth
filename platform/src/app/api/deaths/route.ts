/**
 * API: /api/deaths
 * GET  — List deaths (supports ?patientId=xxx, ?state=xxx, ?facilityId=xxx)
 * POST — Register a new death
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { authorizeJson } from '@/lib/api-json-guard';
import { isContext, pickAllowed, resolveCreateContext, resolveRegisterFacility } from '@/lib/api-create-guard';
import { VITAL_EVENTS_READ_ROLES as READ_ROLES, VITAL_EVENTS_REGISTER_ROLES as WRITE_ROLES } from '@/lib/api-capabilities';
/**
 * Client-settable death fields. Void state, attribution, tenancy, ids and
 * timestamps are server-owned. `patientId`, `encounterId`, `facilityId` and
 * `orgId` (cross-org roles only) are checked below before use.
 */
const DEATH_FIELDS = [
  'deceasedFirstName', 'deceasedSurname', 'deceasedGender', 'dateOfBirth', 'dateOfDeath',
  'ageAtDeath', 'placeOfDeath', 'immediateCause', 'immediateICD11', 'antecedentCause1',
  'antecedentICD11_1', 'antecedentCause2', 'antecedentICD11_2', 'underlyingCause',
  'underlyingICD11', 'contributingConditions', 'contributingICD11', 'mannerOfDeath',
  'maternalDeath', 'pregnancyRelated', 'certifiedBy', 'certifierRole', 'state', 'county',
  'certificateNumber', 'deathNotified', 'deathRegistered',
] as const;
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllDeaths, getDeathsByFacility, getDeathStats,
    } = await import('@/lib/services/death-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const state = url.searchParams.get('state');
    const facilityId = url.searchParams.get('facilityId');
    const includeStats = url.searchParams.get('stats') === 'true';
    const scope = buildScopeFromAuth(auth);
    let deaths;
    if (patientId) {
      // patientId query — scope-filtered deaths by patientId
      const all = await getAllDeaths(scope);
      deaths = all.filter(d => d.patientId === patientId);
    } else if (state) {
      // state query — scope-filtered deaths by state
      const all = await getAllDeaths(scope);
      deaths = all.filter(d => d.state === state);
    } else if (facilityId) {
      // facility query — non-admins are still bound to their hospital scope
      // through middleware-enforced JWT, but we filter once more to be safe.
      const all = await getDeathsByFacility(facilityId);
      deaths = (auth.role === 'super_admin' || auth.role === 'government' || auth.role === 'org_admin')
        ? all
        : all.filter(d => !auth.hospitalId || d.facilityId === auth.hospitalId);
    } else {
      // default: all deaths with scope
      deaths = await getAllDeaths(scope);
    }
    const response: Record<string, unknown> = { deaths, total: deaths.length };
    if (includeStats) {
      response.stats = await getDeathStats(scope);
    }
    return NextResponse.json(response);
  } catch (err) {
    logApiError('[API /deaths GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const guarded = await authorizeJson(request, WRITE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    // Validate required fields
    if (!body.deceasedFirstName || !body.deceasedSurname || !body.dateOfDeath) {
      return NextResponse.json(
        { error: 'deceasedFirstName, deceasedSurname, and dateOfDeath are required' },
        { status: 400 }
      );
    }
    const data: Record<string, unknown> = pickAllowed(body, DEATH_FIELDS);
    // Linking a death to a patient marks that chart deceased, so the patient
    // must be inside the caller's tenant and facility scope.
    if (body.patientId !== undefined && body.patientId !== null && body.patientId !== '') {
      const ctx = await resolveCreateContext(auth, body.patientId, undefined);
      if (!isContext(ctx)) return ctx.response;
      data.patientId = ctx.patient._id;
      // A visit id is kept only when it belongs to this patient inside the caller's scope.
      if (typeof body.encounterId === 'string' && body.encounterId) {
        try {
          const { resolvePatientEncounter } = await import('@/lib/services/encounter-service');
          const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
          const enc = await resolvePatientEncounter(body.encounterId, ctx.patient._id, buildScopeFromAuth(auth));
          if (enc?._id) data.encounterId = enc._id;
        } catch { /* unverifiable: treated as absent */ }
      }
    }
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
    const { createDeath } = await import('@/lib/services/death-service');
    const death = await createDeath(
      data as unknown as Parameters<typeof createDeath>[0],
      (await import('@/lib/services/data-scope')).buildScopeFromAuth(auth),
    );
    return NextResponse.json({ death }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === 'ValidationError') {
      return NextResponse.json({ error: err.message, fields: (err as Error & { fields?: Record<string, string> }).fields }, { status: 400 });
    }
    logApiError('[API /deaths POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'death.create' });
