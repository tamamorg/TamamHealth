/**
 * API: /api/follow-ups
 * GET  — List follow-ups (supports ?workerId=xxx&patientId=xxx&view=pending|stats)
 * POST — Create a new follow-up or update status
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import { authorizeJson } from '@/lib/api-json-guard';
import { isContext, patientDisplayName, pickAllowed, resolveCreateContext } from '@/lib/api-create-guard';
/** Client-settable follow-up fields. Everything else is server-owned. */
const FOLLOW_UP_FIELDS = [
  'encounterId', 'geocodeId', 'condition', 'facilityLevel', 'scheduledDate', 'notes',
  'state', 'county', 'sourceVisitId',
] as const;
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
    const guarded = await authorizeJson(request, WRITE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
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
    const ctx = await resolveCreateContext(auth, body.patientId, body.hospitalId);
    if (!isContext(ctx)) return ctx.response;
    // Allow-list. `assignedWorker` is an assignment target (a supervisor hands
    // a follow-up to a CHW), so it is honoured; status/outcome/completion are
    // server-owned on create (a follow-up always starts active).
    const doc: Record<string, unknown> = {
      ...pickAllowed(body, FOLLOW_UP_FIELDS),
      patientId: ctx.patient._id,
      patientName: patientDisplayName(ctx.patient),
      status: 'active',
    };
    doc.assignedWorker = body.assignedWorker || auth.sub;
    doc.assignedWorkerName = body.assignedWorkerName || auth.name;
    if (ctx.hospitalId) doc.hospitalId = ctx.hospitalId;
    if (ctx.orgId) doc.orgId = ctx.orgId;
    const { createFollowUp } = await import('@/lib/services/follow-up-service');
    const followUp = await createFollowUp(doc as Parameters<typeof createFollowUp>[0]);
    return NextResponse.json({ followUp }, { status: 201 });
  } catch (err) {
    logApiError('[API /follow-ups POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'followup.create' });
