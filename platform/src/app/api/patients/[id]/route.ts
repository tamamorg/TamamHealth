/**
 * API: /api/patients/:id
 * GET   — Retrieve a single patient
 * PATCH — Update patient fields
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized, validationError } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'front_desk', 'medical_superintendent', 'hrio',
  'data_entry_clerk',
  'nutritionist', 'radiologist',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'front_desk', 'medical_superintendent', 'hrio', 'data_entry_clerk',
];
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getPatientById } = await import('@/lib/services/patient-service');
    const patient = await getPatientById(id);
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    if (filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('Access denied to this patient record');
    }
    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a clinician's chart open into an error.
    import('@/lib/services/audit-service').then(({ logPhiRead }) =>
      logPhiRead(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/patients/:id' },
        'patient',
        { patientId: id },
      ),
    ).catch(() => {});
    return NextResponse.json({ patient });
  } catch (err) {
    logApiError('[API /patients/:id GET]', err);
    return serverError();
  }
}
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
    // Prevent changing immutable fields
    delete body._id;
    delete body._rev;
    delete body.type;
    delete body.createdAt;
    const { sanitizePayload } = await import('@/lib/validation');
    const sanitized = sanitizePayload(body);
    // A partial edit form may serialize untouched inputs as empty strings. Merging
    // those over the stored record would silently wipe existing demographics
    // (e.g. nokPhone: ''). Drop empty/undefined keys so PATCH only updates fields
    // the caller actually provided a value for. To clear a field, send an explicit
    // null.
    for (const key of Object.keys(sanitized)) {
      const v = sanitized[key];
      if (v === undefined || v === '') delete sanitized[key];
    }
    const { updatePatient, getPatientById } = await import('@/lib/services/patient-service');
    const existing = await getPatientById(id);
    if (!existing) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    if (filterByScope([existing], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('Access denied to this patient record');
    }
    const updated = await updatePatient(id, sanitized);
    if (!updated) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    return NextResponse.json({ patient: updated });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ValidationError') {
      const ve = err as Error & { fields: Record<string, string> };
      return validationError(ve.fields);
    }
    logApiError('[API /patients/:id PATCH]', err);
    return serverError();
  }
}
export const PATCH = withAuditLog(patchHandler, { action: 'patient.update' });
