/**
 * API: /api/hospitals
 * GET  — List all hospitals or get by ID (supports ?id=xxx)
 * POST — Create a hospital or update hospital status
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent', 'front_desk', 'pharmacist',
];
// Mirrors FACILITY_MANAGE_ROLES (lib/facility-access.ts): every role whose UI
// offers facility create/edit must be able to reach this route, because the
// browser no longer writes facilities locally.
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hrio',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllHospitals, getHospitalById } = await import('@/lib/services/hospital-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) {
      // Get single hospital by ID
      const hospital = await getHospitalById(id, scope);
      if (!hospital) {
        return NextResponse.json({ error: 'Hospital not found' }, { status: 404 });
      }
      return NextResponse.json({ hospital });
    }
    // default: all hospitals with scope
    const hospitals = await getAllHospitals(scope);
    return NextResponse.json({ hospitals, total: hospitals.length });
  } catch (err) {
    logApiError('[API /hospitals GET]', err);
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
    const action = body.action as string;
    // Update a facility. The whole editable surface, not just status fields —
    // the browser routes updateFacility/setFacilityActive through here now, so
    // beds, services, coordinates and retirement all arrive on this action.
    // Identity and tenancy stay server-owned: updateHospitalStatus already
    // pins _id/_rev/orgId from the stored document, and the scope check hides
    // other tenants' facilities from scoped callers.
    if (action === 'update' && body.id) {
      const { updateHospitalStatus } = await import('@/lib/services/hospital-service');
      const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
      const { action: _action, id, _id, _rev, type: _type, orgId: _orgId, createdAt: _createdAt, ...patch } = body as Record<string, unknown>;
      const updated = await updateHospitalStatus(
        id as string,
        patch as Parameters<typeof updateHospitalStatus>[1],
        buildScopeFromAuth(auth),
      );
      if (!updated) return NextResponse.json({ error: 'Hospital not found' }, { status: 404 });
      return NextResponse.json({ hospital: updated });
    }
    // Create new hospital. Location is state + town (the facility form's
    // fields and validateFacilityForm's rule); `lga` is a legacy alias some
    // API consumers still send and is accepted, never required.
    if (!body.name || !body.state || !(body.town || body.lga)) {
      return NextResponse.json(
        { error: 'name, state, and town are required' },
        { status: 400 }
      );
    }
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) body.orgId = auth.orgId;
      else delete body.orgId;
    }
    // `createHospital` refuses a facility with no organisation (it would be
    // rejected by the tenant validator on push and hidden by filterByScope
    // everywhere else). That is a bad request, not a server fault: it means a
    // scoped caller has no orgId on their session, or a platform admin did not
    // name the org to create it under.
    if (!body.orgId) {
      return NextResponse.json(
        { error: 'orgId is required — name the organization this facility belongs to' },
        { status: 400 },
      );
    }
    const { createHospital } = await import('@/lib/services/hospital-service');
    const hospital = await createHospital(body as Parameters<typeof createHospital>[0], auth.sub, auth.username);
    return NextResponse.json({ hospital }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === 'ValidationError') {
      const fields = (err as Error & { fields?: Record<string, string> }).fields;
      return NextResponse.json(
        { error: fields ? Object.values(fields)[0] : err.message, fields },
        { status: 400 },
      );
    }
    logApiError('[API /hospitals POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'hospital.create' });
