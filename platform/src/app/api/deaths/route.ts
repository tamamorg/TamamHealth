/**
 * API: /api/deaths
 * GET  — List deaths (supports ?patientId=xxx, ?state=xxx, ?facilityId=xxx)
 * POST — Register a new death
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
    if (!body.deceasedFirstName || !body.deceasedSurname || !body.dateOfDeath) {
      return NextResponse.json(
        { error: 'deceasedFirstName, deceasedSurname, and dateOfDeath are required' },
        { status: 400 }
      );
    }
    // Inject auth context
    body.registeredBy = body.registeredBy || auth.sub;
    body.registeredByName = body.registeredByName || auth.name;
    if (!body.facilityId && auth.hospitalId) body.facilityId = auth.hospitalId;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) body.orgId = auth.orgId;
      else delete body.orgId;
    }
    const { createDeath } = await import('@/lib/services/death-service');
    const death = await createDeath(body as Parameters<typeof createDeath>[0]);
    return NextResponse.json({ death }, { status: 201 });
  } catch (err) {
    logApiError('[API /deaths POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'death.create' });
