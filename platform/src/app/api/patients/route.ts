/**
 * API: /api/patients
 * GET  — List patients (supports ?q=search&hospitalId=xxx)
 * POST — Create a new patient
 *
 * Access: doctor, clinical_officer, nurse, front_desk,
 *         medical_superintendent, hrio, super_admin, org_admin
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, validationError, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
// Roles that may read patient lists
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'front_desk', 'cashier', 'medical_superintendent', 'hrio',
  'data_entry_clerk',
  'nutritionist', 'radiologist', 'government',
];
// Roles that may create patients. data_entry_clerk keeps READ (patient lookup
// while registering vital events) but not CREATE — the role has no /patients
// module in ROLE_ROUTE_TABLE, so registration is not part of its workflow.
const CREATE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'front_desk', 'medical_superintendent', 'hrio',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    // Dynamic import to avoid PouchDB SSR crash — these services use PouchDB
    // on the client, but the API layer will forward to PostgreSQL when available.
    const { getAllPatients, searchPatients } = await import('@/lib/services/patient-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const scope = buildScopeFromAuth(auth);
    let patients;
    if (query && query.trim().length > 0) {
      patients = await searchPatients(query.trim(), scope);
    } else {
      patients = await getAllPatients(scope);
    }
    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a clinician's list view into an error.
    import('@/lib/services/audit-service').then(({ logPhiSearch }) =>
      logPhiSearch(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/patients' },
        'patient',
        { query: new URL(request.url).searchParams.get('q') || undefined, resultCount: Array.isArray(patients) ? patients.length : 0 },
      ),
    ).catch(() => {});
    return NextResponse.json({ patients, total: patients.length });
  } catch (err) {
    logApiError('[API /patients GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, CREATE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { createPatient } = await import('@/lib/services/patient-service');
    const { sanitizePayload } = await import('@/lib/validation');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    // Sanitize text fields to prevent stored XSS
    const sanitized = sanitizePayload(body);
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) sanitized.orgId = auth.orgId;
      else delete sanitized.orgId;
    }
    sanitized.createdBy = auth.sub;
    // Scope so duplicate-detection and geocode assignment don't read/disclose
    // across tenant boundaries (see createPatient's own docs).
    const scope = buildScopeFromAuth(auth);
    const patient = await createPatient(sanitized as Parameters<typeof createPatient>[0], scope);
    return NextResponse.json({ patient }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ValidationError') {
      const ve = err as Error & { fields: Record<string, string> };
      return validationError(ve.fields);
    }
    logApiError('[API /patients POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'patient.create' });
