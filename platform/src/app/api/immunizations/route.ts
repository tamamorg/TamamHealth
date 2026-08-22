/**
 * API: /api/immunizations
 * GET  — List immunizations (supports ?patientId=xxx, ?facilityId=xxx, ?defaulters=true for coverage stats)
 * POST — Record an immunization
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'medical_superintendent', 'front_desk', 'hrio',
  'data_entry_clerk', 'government',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
  'medical_superintendent', 'data_entry_clerk',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllImmunizations, getByPatient, getByFacility, getDefaulters,
      getDefaulterStats, getImmunizationStats, getVaccineCoverage, getCoverageByAgeCohort,
    } = await import('@/lib/services/immunization-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const facilityId = url.searchParams.get('facilityId');
    const showDefaulters = url.searchParams.get('defaulters') === 'true';
    const includeStats = url.searchParams.get('stats') === 'true';
    const includeCoverage = url.searchParams.get('coverage') === 'true';
    const includeCohorts = url.searchParams.get('cohorts') === 'true';
    let immunizations;
    if (patientId) {
      const rows = await getByPatient(patientId);
      immunizations = filterByScope(rows, buildScopeFromAuth(auth));
    } else if (facilityId) {
      const rows = await getByFacility(facilityId);
      immunizations = filterByScope(rows, buildScopeFromAuth(auth));
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
    const immunization = await createImmunization(body as Parameters<typeof createImmunization>[0]);
    return NextResponse.json({ immunization }, { status: 201 });
  } catch (err) {
    logApiError('[API /immunizations POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'immunization.create' });
