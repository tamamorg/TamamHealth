/**
 * FHIR R4: GET /fhir/Observation?patient=<id>
 * Returns a searchset Bundle of lab-backed Observations for a patient.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole, LabResultDoc } from '@/lib/db-types';

const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'doctor', 'clinical_officer',
  'nurse', 'medical_superintendent', 'hrio', 'lab_tech', 'radiologist',
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
    // Accept either a bare id or Patient/<id>
    const patientId = patientRef.replace(/^Patient\//, '');

    const { getAllLabResults } = await import('@/lib/services/lab-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const { toFhirObservation } = await import('@/lib/fhir');
    const scope = buildScopeFromAuth(auth);
    const labs = (await getAllLabResults(scope) as LabResultDoc[]).filter((l) => l.patientId === patientId);

    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a FHIR consumer's read into an error.
    import('@/lib/services/audit-service').then(({ logPhiRead }) =>
      logPhiRead(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/fhir/Observation' },
        'Observation',
        { patientId, resultCount: labs.length },
      ),
    ).catch(() => {});

    return NextResponse.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: labs.length,
      entry: labs.map((l) => ({ fullUrl: `Observation/${l._id}`, resource: toFhirObservation(l) })),
    }, { headers: { 'Content-Type': 'application/fhir+json' } });
  } catch (err) {
    logApiError('[FHIR Observation GET]', err);
    return serverError();
  }
}
