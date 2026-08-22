/**
 * API: /api/births
 * GET  — List births (supports ?motherId=xxx, ?patientId=xxx, ?state=xxx)
 * POST — Register a new birth
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
    if (!body.childFirstName || !body.childSurname || !body.motherName || !body.dateOfBirth) {
      return NextResponse.json(
        { error: 'childFirstName, childSurname, motherName, and dateOfBirth are required' },
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
    const { createBirth } = await import('@/lib/services/birth-service');
    const birth = await createBirth(body as Parameters<typeof createBirth>[0]);
    return NextResponse.json({ birth }, { status: 201 });
  } catch (err) {
    logApiError('[API /births POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'birth.create' });
