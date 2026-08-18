/**
 * API: /api/follow-ups
 * GET  — List follow-ups (supports ?workerId=xxx&patientId=xxx&view=pending|stats)
 * POST — Create a new follow-up or update status
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'nurse',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllFollowUps, getFollowUpsByWorker, getFollowUpsByPatient,
      getPendingFollowUps, getFollowUpStats,
    } = await import('@/lib/services/follow-up-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const workerId = url.searchParams.get('workerId');
    const patientId = url.searchParams.get('patientId');
    const view = url.searchParams.get('view');
    if (view === 'stats') {
      const stats = await getFollowUpStats(workerId || undefined, scope);
      return NextResponse.json(stats);
    }
    if (view === 'pending') {
      const pending = await getPendingFollowUps(workerId || undefined, scope);
      return NextResponse.json({ followUps: pending, total: pending.length });
    }
    let followUps;
    if (workerId) {
      const rows = await getFollowUpsByWorker(workerId);
      followUps = filterByScope(rows, scope);
    } else if (patientId) {
      const rows = await getFollowUpsByPatient(patientId);
      followUps = filterByScope(rows, scope);
    } else {
      followUps = await getAllFollowUps(scope);
    }
    return NextResponse.json({ followUps, total: followUps.length });
  } catch (err) {
    logApiError('[API /follow-ups GET]', err);
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
    // Update existing follow-up
    if (body.action === 'update' && body.followUpId) {
      const { updateFollowUp } = await import('@/lib/services/follow-up-service');
      const updates: Record<string, unknown> = {};
      if (body.status) updates.status = body.status;
      if (body.outcome) updates.outcome = body.outcome;
      if (body.completedDate) updates.completedDate = body.completedDate;
      if (body.notes) updates.notes = body.notes;
      const result = await updateFollowUp(body.followUpId as string, updates as Parameters<typeof updateFollowUp>[1], scope);
      if (!result) return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
      return NextResponse.json({ followUp: result });
    }
    // Create new follow-up
    if (!body.patientId || !body.condition || !body.scheduledDate) {
      return NextResponse.json(
        { error: 'patientId, condition, and scheduledDate are required' },
        { status: 400 }
      );
    }
    body.assignedWorker = body.assignedWorker || auth.sub;
    body.assignedWorkerName = body.assignedWorkerName || auth.name;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) body.orgId = auth.orgId;
      else delete body.orgId;
    }
    const { createFollowUp } = await import('@/lib/services/follow-up-service');
    const followUp = await createFollowUp(body as Parameters<typeof createFollowUp>[0]);
    return NextResponse.json({ followUp }, { status: 201 });
  } catch (err) {
    logApiError('[API /follow-ups POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'followup.create' });
