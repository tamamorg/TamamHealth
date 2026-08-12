/**
 * API: /api/emergency-plans
 * GET   — List plans (supports ?active=true, ?facilityId=, ?dashboard=true, ?alerts=true, ?id=)
 * POST  — Create a new emergency plan
 * PATCH — Update plan, activate, deactivate, or close (via ?action=activate|deactivate|close)
 * DELETE — Delete a plan (requires ?id=)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent', 'hrio', 'government',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'government',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllPlans, getActivePlans, getPlanById,
      getSurgeAlerts, getEmergencyDashboard,
    } = await import('@/lib/services/emergency-preparedness-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const active = url.searchParams.get('active');
    const dashboard = url.searchParams.get('dashboard');
    const alerts = url.searchParams.get('alerts');
    const facilityId = url.searchParams.get('facilityId') || undefined;
    if (id) {
      const plan = await getPlanById(id);
      if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
      return NextResponse.json({ plan });
    }
    if (dashboard) {
      const data = await getEmergencyDashboard(facilityId);
      return NextResponse.json(data);
    }
    if (alerts) {
      const surgeAlerts = await getSurgeAlerts(facilityId);
      return NextResponse.json({ alerts: surgeAlerts, total: surgeAlerts.length });
    }
    if (active) {
      const plans = await getActivePlans(facilityId);
      return NextResponse.json({ plans, total: plans.length });
    }
    const scope = buildScopeFromAuth(auth);
    const plans = await getAllPlans(scope);
    return NextResponse.json({ plans, total: plans.length });
  } catch (err) {
    logApiError('[API /emergency-plans GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'emergency-plans:write', 20);
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
    if (!body.orgId && auth.orgId) body.orgId = auth.orgId;
    if (auth.role !== 'super_admin' && auth.role !== 'org_admin' && auth.role !== 'government') {
      if (body.facilityId && auth.hospitalId && body.facilityId !== auth.hospitalId) {
        return forbidden('Cannot create plans at a facility you are not assigned to');
      }
      body.facilityId = auth.hospitalId;
    }
    if (auth.role === 'org_admin') {
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      const target = body.facilityId ? await getHospitalById(body.facilityId as string) : null;
      if (target && target.orgId && auth.orgId && target.orgId !== auth.orgId) {
        return forbidden('Cannot create plans in another organization');
      }
    }
    const { createPlan } = await import('@/lib/services/emergency-preparedness-service');
    const plan = await createPlan(body as Parameters<typeof createPlan>[0]);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    logApiError('[API /emergency-plans POST]', err);
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
    const action = url.searchParams.get('action');
    if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    const {
      updatePlan, activatePlan, deactivatePlan, closePlan,
    } = await import('@/lib/services/emergency-preparedness-service');
    let result;
    switch (action) {
      case 'activate': {
        let body: Record<string, unknown> = {};
        try { body = await request.json(); } catch { /* no body needed */ }
        result = await activatePlan(id, auth.name || auth.sub, body.severity as Parameters<typeof activatePlan>[2]);
        break;
      }
      case 'deactivate':
        result = await deactivatePlan(id, auth.name || auth.sub);
        break;
      case 'close':
        result = await closePlan(id);
        break;
      default: {
        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const { sanitizePayload } = await import('@/lib/validation');
        body = sanitizePayload(body);
        result = await updatePlan(id, body);
      }
    }
    if (!result) return NextResponse.json({ error: 'Plan not found or action failed' }, { status: 404 });
    return NextResponse.json({ plan: result });
  } catch (err) {
    logApiError('[API /emergency-plans PATCH]', err);
    return serverError();
  }
}
async function deleteHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'emergency-plans:delete', 10);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    const { deletePlan } = await import('@/lib/services/emergency-preparedness-service');
    const deleted = await deletePlan(id);
    if (!deleted) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    logApiError('[API /emergency-plans DELETE]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'emergency.plan.create' });
export const PATCH = withAuditLog(patchHandler, { action: 'emergency.plan.update' });
export const DELETE = withAuditLog(deleteHandler, { action: 'emergency.plan.delete' });
