/**
 * API: /api/medical-records/[id]
 * GET   — Retrieve a single medical record
 * PATCH — Update a medical record
 * DELETE — Delete a medical record (soft-delete via status, or hard delete)
 */
import { CLINICIANS } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError } from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
const WRITE_ROLES = CLINICIANS;
async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    // Prevent changing immutable fields
    const immutable = ['_id', '_rev', 'type', 'createdAt'];
    for (const key of immutable) {
      delete body[key];
    }
    const { sanitizePayload } = await import('@/lib/validation');
    const sanitized = sanitizePayload(body);
    const { updateMedicalRecord, getMedicalRecordById } = await import('@/lib/services/medical-record-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    // Scope guard: a clinician may only amend records their org/facility can
    // see — same rule as the read path. filterByScope treats a record with no
    // orgId as deny for scoped roles, closing the legacy-null-orgId bypass, and
    // also enforces facility scope (the old check was org-only).
    const existing = await getMedicalRecordById(id);
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    if (filterByScope([existing], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('Access denied to this record');
    }
    const updated = await updateMedicalRecord(id, sanitized as Parameters<typeof updateMedicalRecord>[1]);
    if (!updated) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json({ record: updated });
  } catch (err) {
    logApiError('[API /medical-records/[id] PATCH]', err);
    return serverError();
  }
}
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'medical-records:delete', 10);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ['super_admin', 'medical_superintendent'])) return forbidden();
    const { id } = await params;
    const { deleteMedicalRecord, getMedicalRecordById } = await import('@/lib/services/medical-record-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    // Scope guard before deletion — same rule as the read/amend paths.
    const existing = await getMedicalRecordById(id);
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    if (filterByScope([existing], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('Access denied to this record');
    }
    const deleted = await deleteMedicalRecord(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logApiError('[API /medical-records/[id] DELETE]', err);
    return serverError();
  }
}
export const PATCH = withAuditLog(patchHandler, { action: 'medicalrecord.update' });
export const DELETE = withAuditLog(deleteHandler, { action: 'medicalrecord.delete' });
