/**
 * API: /api/lab/:id
 * PATCH — Update a lab result (enter results, mark complete, flag critical)
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import { CLINICIANS } from '@/lib/sync/write-permissions';
import type { LabOrderStatus } from '@/lib/clinical-flow/order-lifecycles';
/** Lab bench and imaging staff: the only roles that enter specimen/result data. */
const RESULT_ROLES: UserRole[] = ['super_admin', 'lab_tech', 'radiologist'];
const WRITE_ROLES: UserRole[] = [...CLINICIANS, 'lab_tech', 'radiologist'];
/**
 * Result and specimen fields -- lab/radiology only. `status`, `completedAt`
 * and `reportedAt` are NOT accepted from the body: the coarse status and the
 * timestamps are derived server-side from the lifecycle stage.
 */
const RESULT_FIELDS = [
  'result', 'unit', 'referenceRange', 'abnormal', 'critical',
  'observations', 'clinicalNotes',
  'specimen', 'specimenCollectedAt', 'specimenReceivedAt', 'specimenContainer',
  'specimenCondition', 'specimenRejectionReason', 'specimenRejectionNotes', 'specimenRejectedAt',
  'technique', 'imageCount', 'studyDocumentIds', 'findings', 'impression',
  'repeatReason', 'acquiredAt', 'studyScheduledAt', 'safetyChecks',
] as const;
/** Lifecycle stages only a clinician may move an order into (result review and beyond). */
const REVIEW_STAGES: readonly LabOrderStatus[] = ['reviewed_by_clinician', 'acted_upon', 'communicated_to_patient'];
const ORDER_STAGES: readonly LabOrderStatus[] = [
  'ordered', 'specimen_collected', 'received_at_lab', 'rejected_needs_recollection', 'in_process',
  'resulted', ...REVIEW_STAGES,
];
async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    // Explicit allow-list: bench/result fields only. patientId, orgId,
    // hospitalId, _id, _rev, type, createdAt, the ordering/author fields and
    // every status/stamp field (status, completedAt, reportedAt, reportedBy,
    // reviewedBy ...) are never accepted from the body.
    const patch: Record<string, unknown> = {};
    for (const key of RESULT_FIELDS) {
      if (key in body && body[key] !== undefined) patch[key] = body[key];
    }
    let targetStage: LabOrderStatus | undefined;
    if (body.orderStatus !== undefined) {
      if (typeof body.orderStatus !== 'string' || !ORDER_STAGES.includes(body.orderStatus as LabOrderStatus)) {
        return NextResponse.json({ error: 'Unknown orderStatus' }, { status: 400 });
      }
      targetStage = body.orderStatus as LabOrderStatus;
    }
    if (Object.keys(patch).length === 0 && !targetStage) {
      return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
    }
    // Per-role split: results/specimen data are written by lab and imaging
    // staff only; the review stages are clinician decisions.
    if (Object.keys(patch).length > 0 && !hasRole(auth, RESULT_ROLES)) {
      return forbidden('Only laboratory or radiology staff can enter results.');
    }
    if (targetStage) {
      const needed = REVIEW_STAGES.includes(targetStage) ? CLINICIANS : RESULT_ROLES;
      if (!hasRole(auth, needed)) {
        return forbidden(REVIEW_STAGES.includes(targetStage)
          ? 'Only a clinician can review or act on a result.'
          : 'Only laboratory or radiology staff can advance a specimen or result.');
      }
    }
    const { sanitizePayload } = await import('@/lib/validation');
    const sanitized = sanitizePayload(patch);
    const { updateLabResult, getLabResultById } = await import('@/lib/services/lab-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    // Tenant guard: only mutate/read-back a result the caller's org/facility
    // owns. Without this, any lab_tech/clinician could PATCH another tenant's
    // result by id and receive its decrypted value + clinical notes back.
    const existing = await getLabResultById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Lab result not found' }, { status: 404 });
    }
    if (filterByScope([existing], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('Access denied to this lab result.');
    }
    const { advanceLabOrder, effectiveOrderStatus } = await import('@/lib/services/lab-service');
    const now = new Date().toISOString();
    const currentStage = effectiveOrderStatus(existing);
    // A reviewed result is the clinician's record of what they saw: the bench
    // cannot rewrite it underneath them.
    if (Object.keys(sanitized).length > 0 && REVIEW_STAGES.includes(currentStage)) {
      return NextResponse.json(
        { error: 'This result has already been reviewed and can no longer be edited.' },
        { status: 409 },
      );
    }
    // Actor stamps come from the session, never the body.
    const stamps: Record<string, unknown> = {};
    if (targetStage === 'resulted' || (!targetStage && currentStage === 'resulted' && Object.keys(sanitized).length > 0)) {
      stamps.reportedBy = auth.name || auth.sub;
      if (targetStage === 'resulted') stamps.reportedAt = now;
    }
    if (targetStage === 'reviewed_by_clinician') { stamps.reviewedBy = auth.name || auth.sub; stamps.reviewedAt = now; }
    if (targetStage === 'acted_upon') { stamps.actedUponBy = auth.name || auth.sub; stamps.actedUponAt = now; }
    if (targetStage === 'communicated_to_patient') { stamps.communicatedBy = auth.name || auth.sub; stamps.communicatedAt = now; }
    let updated;
    if (targetStage) {
      try {
        updated = await advanceLabOrder(id, targetStage, { ...sanitized, ...stamps });
      } catch (err) {
        if (err instanceof Error && /^Illegal lab order transition/.test(err.message)) {
          return NextResponse.json({ error: err.message }, { status: 409 });
        }
        throw err;
      }
    } else {
      updated = await updateLabResult(id, { ...sanitized, ...stamps });
    }
    if (!updated) {
      return NextResponse.json({ error: 'Lab result not found' }, { status: 404 });
    }
    return NextResponse.json({ labResult: updated });
  } catch (err) {
    const e = err as { status?: number; name?: string } | null;
    if (e?.status === 409 || e?.name === 'conflict') {
      return NextResponse.json(
        { error: 'This lab result was changed by someone else at the same time. Reload it and try again.' },
        { status: 409 },
      );
    }
    logApiError('[API /lab/:id PATCH]', err);
    return serverError();
  }
}
export const PATCH = withAuditLog(patchHandler, { action: 'lab.update' });
