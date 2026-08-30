/**
 * FHIR R4: GET /fhir/Patient/:id
 * Returns a Patient resource serialized from the PouchDB patient doc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';

const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'doctor', 'clinical_officer',
  'nurse', 'medical_superintendent', 'hrio', 'data_entry_clerk', 'front_desk',
  'radiologist', 'nutritionist',
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
    const { filterByScope, buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const { toFhirPatient } = await import('@/lib/fhir');
    const patient = await getPatientById(id);
    if (!patient) {
      return NextResponse.json(
        { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Patient not found' }] },
        { status: 404, headers: { 'Content-Type': 'application/fhir+json' } }
      );
    }

    // Reuse the central scope filter so org + hospital rules stay in lockstep
    // with all other read paths. A non-admin caller from org A asking for a
    // patient in org B (or for a patient that has no orgId at all) gets
    // filtered out and we surface a 403 — never a cross-tenant leak.
    const scope = buildScopeFromAuth(auth);
    const allowed = filterByScope([patient], scope);
    if (allowed.length === 0) {
      return forbidden('Access denied to this patient record');
    }

    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a FHIR consumer's read into an error.
    import('@/lib/services/audit-service').then(({ logPhiRead }) =>
      logPhiRead(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/fhir/Patient/:id' },
        'Patient',
        { patientId: id },
      ),
    ).catch(() => {});

    return NextResponse.json(toFhirPatient(patient), {
      headers: { 'Content-Type': 'application/fhir+json' },
    });
  } catch (err) {
    logApiError('[FHIR Patient/:id GET]', err);
    return serverError();
  }
}
