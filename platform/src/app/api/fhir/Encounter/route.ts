/**
 * FHIR R4: GET /fhir/Encounter?patient=<id>
 * Returns a searchset Bundle of Encounter resources backed by medical_record docs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';

const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'doctor', 'clinical_officer',
  'nurse', 'medical_superintendent', 'hrio',
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

    const { getRecordsByPatient } = await import('@/lib/services/medical-record-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const { toFhirEncounter } = await import('@/lib/fhir');
    const records = await getRecordsByPatient(patientId, buildScopeFromAuth(auth));

    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a FHIR consumer's read into an error.
    import('@/lib/services/audit-service').then(({ logPhiRead }) =>
      logPhiRead(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/fhir/Encounter' },
        'Encounter',
        { patientId, resultCount: records.length },
      ),
    ).catch(() => {});

    return NextResponse.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: records.length,
      entry: records.map((r) => ({ fullUrl: `Encounter/${r._id}`, resource: toFhirEncounter(r) })),
    }, { headers: { 'Content-Type': 'application/fhir+json' } });
  } catch (err) {
    logApiError('[FHIR Encounter GET]', err);
    return serverError();
  }
}
