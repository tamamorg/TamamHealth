/**
 * API: /api/immunizations
 * GET  — List immunizations (supports ?patientId=xxx, ?facilityId=xxx, ?defaulters=true for coverage stats)
 * POST — Record an immunization
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { authorizeJson } from '@/lib/api-json-guard';
import { VITAL_EVENTS_READ_ROLES as READ_ROLES, VITAL_EVENTS_REGISTER_ROLES as WRITE_ROLES } from '@/lib/api-capabilities';
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllImmunizations, getByPatient, getByFacility, getDefaulters,
      getDefaulterStats, getImmunizationStats, getVaccineCoverage, getCoverageByAgeCohort,
    } = await import('@/lib/services/immunization-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const facilityId = url.searchParams.get('facilityId');
    const showDefaulters = url.searchParams.get('defaulters') === 'true';
    const includeStats = url.searchParams.get('stats') === 'true';
    const includeCoverage = url.searchParams.get('coverage') === 'true';
    const includeCohorts = url.searchParams.get('cohorts') === 'true';
    let immunizations;
    if (patientId) {
      immunizations = await getByPatient(patientId, buildScopeFromAuth(auth));
    } else if (facilityId) {
      immunizations = await getByFacility(facilityId, buildScopeFromAuth(auth));
    } else if (showDefaulters) {
      // Return defaulters list — scoped to caller (P0 tier-isolation).
      const scope = buildScopeFromAuth(auth);
      const defaulters = await getDefaulters(scope);
      const defaulterStats = await getDefaulterStats(scope);
      return NextResponse.json({ defaulters, defaulterStats, total: defaulters.length });
    } else {
      // default: all with scope
      const scope = buildScopeFromAuth(auth);
      immunizations = await getAllImmunizations(scope);
    }
    const response: Record<string, unknown> = { immunizations, total: immunizations.length };
    if (includeStats) {
      const scope = buildScopeFromAuth(auth);
      response.stats = await getImmunizationStats(scope);
    }
    if (includeCoverage) {
      const scope = buildScopeFromAuth(auth);
      response.coverage = await getVaccineCoverage(scope);
    }
    if (includeCohorts) {
      const scope = buildScopeFromAuth(auth);
      response.cohorts = await getCoverageByAgeCohort(scope);
    }
    return NextResponse.json(response);
  } catch (err) {
    logApiError('[API /immunizations GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const guarded = await authorizeJson(request, WRITE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    // Validate required fields
    if (!body.patientId || !body.vaccine || body.doseNumber === undefined) {
      return NextResponse.json(
        { error: 'patientId, vaccine, and doseNumber are required' },
        { status: 400 }
      );
    }
    // Inject auth context
    body.recordedBy = body.recordedBy || auth.sub;
    body.recordedByName = body.recordedByName || auth.name;
    if (!body.facilityId && auth.hospitalId) body.facilityId = auth.hospitalId;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) body.orgId = auth.orgId;
      else delete body.orgId;
    }
    const { createImmunization } = await import('@/lib/services/immunization-service');
    const immunization = await createImmunization(
      body as Parameters<typeof createImmunization>[0],
      (await import('@/lib/services/data-scope')).buildScopeFromAuth(auth),
    );
    return NextResponse.json({ immunization }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === 'ValidationError') {
      return NextResponse.json({ error: err.message, fields: (err as Error & { fields?: Record<string, string> }).fields }, { status: 400 });
    }
    logApiError('[API /immunizations POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'immunization.create' });
