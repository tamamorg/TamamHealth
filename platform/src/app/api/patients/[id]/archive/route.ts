/**
 * API: /api/patients/:id/archive
 * POST — Archive (soft-delete) or restore a patient record.
 *
 * Hard delete of patient records is prohibited (medical retention/audit
 * requirements). Archive flips Patient.isActive off; existing records,
 * appointments and history are preserved and remain queryable by reports.
 *
 * Body: { action: 'archive' | 'restore' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

const ARCHIVE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hrio',
];

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ARCHIVE_ROLES)) return forbidden();

    let body: { action?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body.action;
    if (action !== 'archive' && action !== 'restore') {
      return NextResponse.json(
        { error: "Field 'action' must be 'archive' or 'restore'" },
        { status: 400 }
      );
    }

    const { getPatientById, archivePatient, unarchivePatient } = await import(
      '@/lib/services/patient-service'
    );

    const existing = await getPatientById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    if (filterByScope([existing], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('Access denied to this patient record');
    }

    const actor = auth.name || auth.username;
    const updated = action === 'archive'
      ? await archivePatient(id, actor)
      : await unarchivePatient(id, actor);

    if (!updated) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    return NextResponse.json({ patient: updated, action });
  } catch (err) {
    logApiError('[API /patients/:id/archive POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'patient.archive' });
