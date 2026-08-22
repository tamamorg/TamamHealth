/**
 * API: /api/lab/:id
 * PATCH — Update a lab result (enter results, mark complete, flag critical)
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'lab_tech', 'medical_superintendent',
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
    // Prevent overwriting immutable fields
    delete body._id;
    delete body._rev;
    delete body.type;
    delete body.createdAt;
    const { sanitizePayload } = await import('@/lib/validation');
    const sanitized = sanitizePayload(body);
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
    const updated = await updateLabResult(id, sanitized);
    if (!updated) {
      return NextResponse.json({ error: 'Lab result not found' }, { status: 404 });
    }
    return NextResponse.json({ labResult: updated });
  } catch (err) {
    logApiError('[API /lab/:id PATCH]', err);
    return serverError();
  }
}
export const PATCH = withAuditLog(patchHandler, { action: 'lab.update' });
