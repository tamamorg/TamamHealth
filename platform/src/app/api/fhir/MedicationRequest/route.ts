/**
 * FHIR R4: GET /fhir/MedicationRequest?patient=<id>
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';

const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'doctor', 'clinical_officer',
  'nurse', 'medical_superintendent', 'hrio', 'pharmacist',
];

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();

    const url = new URL(request.url);
    const patientRef = url.searchParams.get('patient') || url.searchParams.get('subject');
    if (!patientRef) {
      return NextResponse.json(
        { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'patient query parameter required' }] },
        { status: 400, headers: { 'Content-Type': 'application/fhir+json' } }
      );
    }
    const patientId = patientRef.replace(/^Patient\//, '');

    const { getPrescriptionsByPatient } = await import('@/lib/services/prescription-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const { toFhirMedicationRequest } = await import('@/lib/fhir');
    const rx = await getPrescriptionsByPatient(patientId, buildScopeFromAuth(auth));

    return NextResponse.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: rx.length,
      entry: rx.map((r) => ({ fullUrl: `MedicationRequest/${r._id}`, resource: toFhirMedicationRequest(r) })),
    }, { headers: { 'Content-Type': 'application/fhir+json' } });
  } catch (err) {
    logApiError('[FHIR MedicationRequest GET]', err);
    return serverError();
  }
}
