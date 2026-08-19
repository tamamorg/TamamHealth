/**
 * API: /api/hospitals
 * GET  — List all hospitals or get by ID (supports ?id=xxx)
 * POST — Create a hospital or update hospital status
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent', 'front_desk', 'pharmacist',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent',
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
    // Update hospital status
    if (action === 'update' && body.id) {
      const { updateHospitalStatus } = await import('@/lib/services/hospital-service');
      const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
      const updated = await updateHospitalStatus(body.id as string, {
        status: body.status as string | undefined,
        syncStatus: body.syncStatus as string | undefined,
        patientCount: body.patientCount !== undefined ? Number(body.patientCount) : undefined,
        todayVisits: body.todayVisits !== undefined ? Number(body.todayVisits) : undefined,
      } as Parameters<typeof updateHospitalStatus>[1], buildScopeFromAuth(auth));
      if (!updated) return NextResponse.json({ error: 'Hospital not found' }, { status: 404 });
      return NextResponse.json({ hospital: updated });
    }
    // Create new hospital
    if (!body.name || !body.state || !body.lga) {
      return NextResponse.json(
        { error: 'name, state, and lga are required' },
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
    const { createHospital } = await import('@/lib/services/hospital-service');
    const hospital = await createHospital(body as Parameters<typeof createHospital>[0], auth.sub, auth.username);
    return NextResponse.json({ hospital }, { status: 201 });
  } catch (err) {
    logApiError('[API /hospitals POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'hospital.create' });
