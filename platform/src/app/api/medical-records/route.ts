/**
 * API: /api/medical-records
 * GET  — List medical records (supports ?patientId=xxx&limit=N)
 * POST — Create a new medical record (consultation)
 */
import { CLINICIANS } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { RECORD_EDITABLE_FIELDS, RECORD_CREATE_ONLY_FIELDS } from '@/lib/medical-record-fields';
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
    // Sanitize text fields, then keep ONLY the clinical fields a caller may
    // write. documentStatus, addenda, type, createdAt, updatedAt and every
    // signing field are server-owned: a body must not be able to mint a
    // "signed" record with no signer or forge addenda.
    const cleaned = sanitizePayload(body);
    const requestedHospitalId = typeof cleaned.hospitalId === 'string' ? cleaned.hospitalId : undefined;
    const sanitized: Record<string, unknown> = {};
    for (const key of [...RECORD_CREATE_ONLY_FIELDS, ...RECORD_EDITABLE_FIELDS]) {
      if (key in cleaned && cleaned[key] !== undefined) sanitized[key] = cleaned[key];
    }
    // The patient must exist and sit inside the caller's scope: a clinician
    // may not file a record against another tenant's patient by id.
    const patientId = typeof sanitized.patientId === 'string' ? sanitized.patientId : '';
    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }
    const { getPatientById } = await import('@/lib/services/patient-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const patient = await getPatientById(patientId, buildScopeFromAuth(auth));
    if (!patient || filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    // Authorship and facility come from the verified session, never the body.
    sanitized.consultedBy = auth.sub;
    sanitized.consultedByName = auth.name;
    sanitized.providerName = auth.name;
    sanitized.providerRole = auth.role;
    // Tenancy is stamped from the session (or, for org-less platform roles,
    // from the in-scope patient) -- never from the client.
    const orgId = auth.orgId ?? patient.orgId;
    // Facility: a clinician covering a second site may file there, and an
    // org-wide role (no home facility) must name one -- but a body hospitalId
    // is honoured only when it is inside the caller's facility entitlement or
    // is the patient's own facility, AND the facility belongs to the caller's
    // org. Otherwise fall back to the home facility.
    let hospitalId: string | undefined = auth.hospitalId;
    if (requestedHospitalId && requestedHospitalId !== auth.hospitalId) {
      const { entitlementFor } = await import('@/lib/sync/facility-entitlements');
      const entitlement = entitlementFor(auth);
      const patientFacilities = [patient.registrationHospital, patient.lastVisitHospital];
      const entitled = entitlement.allFacilities
        || entitlement.facilityIds.includes(requestedHospitalId)
        || patientFacilities.includes(requestedHospitalId);
      if (!entitled) return forbidden('That facility is outside your assignment.');
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      const facility = await getHospitalById(requestedHospitalId);
      if (!facility || !orgId || facility.orgId !== orgId) {
        return forbidden('That facility is outside your organization.');
      }
      hospitalId = requestedHospitalId;
    } else if (!hospitalId) {
      hospitalId = patient.registrationHospital || undefined;
    }
    if (hospitalId) sanitized.hospitalId = hospitalId;
    if (orgId) sanitized.orgId = orgId;
    else delete sanitized.orgId;
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
