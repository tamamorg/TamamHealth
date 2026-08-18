/**
 * API: /api/surveillance
 * GET  — List disease alerts (all, active)
 * POST — Create alert, update alert, or delete alert
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent', 'government', 'county_health_director', 'hrio',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'medical_superintendent', 'government',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllAlerts, getActiveAlerts } = await import('@/lib/services/surveillance-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const filter = request.nextUrl.searchParams.get('filter');
    let alerts;
    if (filter === 'active') {
      alerts = await getActiveAlerts(scope);
    } else {
      alerts = await getAllAlerts(scope);
    }
    return NextResponse.json({ alerts });
  } catch (err) {
    logApiError('[API /surveillance GET]', err);
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
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const action = body.action as string;
    // Delete alert
    if (action === 'delete' && body.alertId) {
      const { deleteAlert } = await import('@/lib/services/surveillance-service');
      const deleted = await deleteAlert(body.alertId as string, scope);
      if (!deleted) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }
    // Update alert
    if (action === 'update' && body.alertId) {
      const { updateAlert } = await import('@/lib/services/surveillance-service');
      const update: Parameters<typeof updateAlert>[1] = {};
      if (body.diseaseName !== undefined) update.disease = body.diseaseName as string;
      if (body.alertLevel !== undefined) update.alertLevel = body.alertLevel as 'normal' | 'watch' | 'warning' | 'emergency';
      if (body.location !== undefined) update.county = body.location as string;
      if (body.reportedBy !== undefined) update.reportedBy = body.reportedBy as string;
      if (body.reportDate !== undefined) update.reportDate = body.reportDate as string;
      if (body.affectedCount !== undefined) update.cases = Number(body.affectedCount);
      if (body.state !== undefined) update.state = body.state as string;
      if (body.county !== undefined) update.county = body.county as string;
      if (body.deaths !== undefined) update.deaths = Number(body.deaths);
      if (body.trend !== undefined) update.trend = body.trend as 'increasing' | 'stable' | 'decreasing';
      const updated = await updateAlert(body.alertId as string, update, scope);
      if (!updated) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
      return NextResponse.json({ alert: updated });
    }
    // Create new alert
    if (!body.diseaseName || !body.description) {
      return NextResponse.json(
        { error: 'diseaseName and description are required' },
        { status: 400 }
      );
    }
    const { createAlert } = await import('@/lib/services/surveillance-service');
    // Map HTTP body to DiseaseAlertDoc shape with sensible defaults.
    // Backward compatible: clients can still send diseaseName/description/affectedCount/location.
    const alert = await createAlert({
      disease: body.diseaseName as string,
      state: (body.state as string) || '',
      county: (body.county as string) || (body.location as string) || '',
      cases: body.affectedCount !== undefined ? Number(body.affectedCount) : (body.cases !== undefined ? Number(body.cases) : 0),
      deaths: body.deaths !== undefined ? Number(body.deaths) : 0,
      alertLevel: (body.alertLevel as 'normal' | 'watch' | 'warning' | 'emergency') || 'watch',
      reportDate: (body.reportDate as string) || new Date().toISOString().slice(0, 10),
      trend: (body.trend as 'increasing' | 'stable' | 'decreasing') || 'stable',
      reportedBy: (body.reportedBy as string) || auth.sub,
      orgId: auth.orgId,
    });
    return NextResponse.json({ alert }, { status: 201 });
  } catch (err) {
    logApiError('[API /surveillance POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'surveillance.create' });
