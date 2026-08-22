/**
 * API: /api/staff-schedules
 * GET    — List schedules (supports ?date=, ?userId=, ?facilityId=, ?onCall=true, ?weekStart=)
 * POST   — Create a new schedule entry
 * PATCH  — Update a schedule (requires ?id=)
 * DELETE — Delete a schedule (requires ?id=)
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
// Staff scheduling is a human-resources function. HRIO (Health Records &
// Information Officer) is records/DHIS2 only and is intentionally excluded.
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'pharmacist', 'medical_superintendent', 'hospital_manager',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllSchedules, getSchedulesByDate, getSchedulesByUser,
      getOnCallStaff, getWeeklyRoster, getStaffingGaps,
    } = await import('@/lib/services/staff-scheduling-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const userId = url.searchParams.get('userId');
    const facilityId = url.searchParams.get('facilityId') || undefined;
    const onCall = url.searchParams.get('onCall');
    const weekStart = url.searchParams.get('weekStart');
    const gaps = url.searchParams.get('gaps');
    if (gaps && date) {
      const staffingGaps = await getStaffingGaps(date, facilityId, scope);
      return NextResponse.json({ gaps: staffingGaps, date });
    }
    if (onCall && date) {
      const staff = await getOnCallStaff(date, facilityId, scope);
      return NextResponse.json({ schedules: staff, total: staff.length });
    }
    if (weekStart) {
      const roster = await getWeeklyRoster(weekStart, facilityId, scope);
      return NextResponse.json({ schedules: roster, total: roster.length });
    }
    if (userId) {
      const schedules = await getSchedulesByUser(userId, scope);
      return NextResponse.json({ schedules, total: schedules.length });
    }
    if (date) {
      const schedules = await getSchedulesByDate(date, facilityId, scope);
      return NextResponse.json({ schedules, total: schedules.length });
    }
    const schedules = await getAllSchedules(scope);
    return NextResponse.json({ schedules, total: schedules.length });
  } catch (err) {
    logApiError('[API /staff-schedules GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'staff-schedules:write', 30);
    if (rateLimitResponse) return rateLimitResponse;
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
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) body.orgId = auth.orgId;
      else delete body.orgId;
    }
    if (auth.role !== 'super_admin' && auth.role !== 'org_admin') {
      if (body.facilityId && auth.hospitalId && body.facilityId !== auth.hospitalId) {
        return forbidden('Cannot create schedules at a facility you are not assigned to');
      }
      body.facilityId = auth.hospitalId;
    }
    if (auth.role === 'org_admin') {
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      const target = body.facilityId ? await getHospitalById(body.facilityId as string) : null;
      if (target && target.orgId && auth.orgId && target.orgId !== auth.orgId) {
        return forbidden('Cannot create schedules in another organization');
      }
    }
    const { createSchedule } = await import('@/lib/services/staff-scheduling-service');
    const schedule = await createSchedule(body as Parameters<typeof createSchedule>[0]);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    logApiError('[API /staff-schedules POST]', err);
    return serverError();
  }
}
async function patchHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    const { updateSchedule } = await import('@/lib/services/staff-scheduling-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const updated = await updateSchedule(id, body, buildScopeFromAuth(auth));
    if (!updated) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    return NextResponse.json({ schedule: updated });
  } catch (err) {
    logApiError('[API /staff-schedules PATCH]', err);
    return serverError();
  }
}
async function deleteHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'staff-schedules:delete', 10);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    const { deleteSchedule } = await import('@/lib/services/staff-scheduling-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const deleted = await deleteSchedule(id, buildScopeFromAuth(auth));
    if (!deleted) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    logApiError('[API /staff-schedules DELETE]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'staff.schedule.create' });
export const PATCH = withAuditLog(patchHandler, { action: 'staff.schedule.update' });
export const DELETE = withAuditLog(deleteHandler, { action: 'staff.schedule.delete' });
