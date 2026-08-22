/**
 * API: /api/medical-records
 * GET  — List medical records (supports ?patientId=xxx&limit=N)
 * POST — Create a new medical record (consultation)
 */
import { CLINICIANS } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'medical_superintendent',
];
const CREATE_ROLES = CLINICIANS;
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getRecordsByPatient, getRecentRecords } = await import('@/lib/services/medical-record-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const { logDataAccess } = await import('@/lib/services/audit-service');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    let records;
    if (patientId) {
      records = await getRecordsByPatient(patientId, buildScopeFromAuth(auth));
      logDataAccess(auth.sub, auth.name, 'MEDICAL_RECORDS', patientId, 'VIEW').catch(() => {});
    } else {
      records = await getRecentRecords(limit, buildScopeFromAuth(auth));
    }
    return NextResponse.json({ records, total: records.length });
  } catch (err) {
    logApiError('[API /medical-records GET]', err);
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
    const { sanitizePayload } = await import('@/lib/validation');
    // Sanitize text fields
    const sanitized = sanitizePayload(body);
    // Inject auth context
    sanitized.consultedBy = sanitized.consultedBy || auth.sub;
    sanitized.consultedByName = sanitized.consultedByName || auth.name;
    if (!sanitized.hospitalId && auth.hospitalId) sanitized.hospitalId = auth.hospitalId;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) sanitized.orgId = auth.orgId;
      else delete sanitized.orgId;
    }
    const { createMedicalRecord } = await import('@/lib/services/medical-record-service');
    const record = await createMedicalRecord(sanitized as Parameters<typeof createMedicalRecord>[0]);
    return NextResponse.json({ record }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ValidationError') {
      const fields = (err as Error & { fields?: unknown }).fields;
      return NextResponse.json({ error: err.message, fields }, { status: 400 });
    }
    logApiError('[API /medical-records POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'medicalrecord.create' });
