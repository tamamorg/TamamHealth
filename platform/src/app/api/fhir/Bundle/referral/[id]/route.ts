/**
 * API: GET /api/fhir/Bundle/referral/:id
 *
 * Produces a FHIR R4 "document" Bundle for a cross-facility or cross-border
 * referral. The Bundle contains the subject Patient plus their recent
 * Encounters, Observations, and MedicationRequests — everything a receiving
 * facility needs to pick up continuity of care.
 *
 * This is the Phase 3 cross-border continuity-of-care packet from the spec.
 * The receiving facility can ingest the Bundle transaction-style (PUT each
 * resource into its local stores) even while offline; the outbox layer
 * handles onward replication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';

const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'doctor', 'clinical_officer',
  'medical_superintendent', 'hrio',
];

/** How far back to include clinical data in the packet. Configurable via query. */
const DEFAULT_HISTORY_DAYS = 90;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();

    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '', 10) || DEFAULT_HISTORY_DAYS;
    const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

    const [
      { getReferralById },
      { getPatientById },
      { getRecordsByPatient },
      { getAllLabResults },
      { getPrescriptionsByPatient },
      { buildScopeFromAuth, filterByScope },
      { toFhirReferralBundle },
    ] = await Promise.all([
      import('@/lib/services/referral-service'),
      import('@/lib/services/patient-service'),
      import('@/lib/services/medical-record-service'),
      import('@/lib/services/lab-service'),
      import('@/lib/services/prescription-service'),
      import('@/lib/services/data-scope'),
      import('@/lib/fhir'),
    ]);

    const referral = await getReferralById(id);
    if (!referral) {
      return NextResponse.json(
        { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Referral not found' }] },
        { status: 404, headers: { 'Content-Type': 'application/fhir+json' } }
      );
    }

    // Run referral through the central scope filter so org + hospital rules
    // stay consistent with every other read path. A non-admin caller from
    // org A pulling a referral packet from org B gets filtered out and we
    // surface a 403 — never a cross-tenant leak. Admin roles (super_admin,
    // government) pass through unchanged via filterByScope's early return.
    const scope = buildScopeFromAuth(auth);
    if (filterByScope([referral], scope).length === 0) {
      return forbidden('Access denied to this referral');
    }

    const patient = referral.patientId ? await getPatientById(referral.patientId) : null;
    // The patient itself must also be in-scope for this caller — otherwise the
    // packet would expose patient demographics outside their own org.
    if (patient && filterByScope([patient], scope).length === 0) {
      return forbidden('Access denied to this referral');
    }

    const [records, labs, prescriptions] = await Promise.all([
      referral.patientId ? getRecordsByPatient(referral.patientId, scope) : Promise.resolve([]),
      referral.patientId
        ? (await getAllLabResults(scope)).filter((l) => l.patientId === referral.patientId)
        : Promise.resolve([]),
      referral.patientId ? getPrescriptionsByPatient(referral.patientId, scope) : Promise.resolve([]),
    ]);

    // Trim to history window
    const recentRecords = records.filter((r) => (r.createdAt || r.visitDate || '') >= sinceIso);
    const recentLabs = labs.filter((l) => (l.createdAt || l.orderedAt || '') >= sinceIso);
    const recentRx = prescriptions.filter((r) => (r.createdAt || '') >= sinceIso);

    const bundle = toFhirReferralBundle(
      referral,
      patient || undefined,
      recentRecords,
      recentLabs,
      recentRx,
    );

    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write must
    // never turn a receiving facility's packet pull into an error.
    import('@/lib/services/audit-service').then(({ logPhiRead }) =>
      logPhiRead(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/fhir/Bundle/referral/:id' },
        'Bundle',
        { patientId: referral.patientId, resourceId: id },
      ),
    ).catch(() => {});

    return NextResponse.json(bundle, {
      headers: { 'Content-Type': 'application/fhir+json' },
    });
  } catch (err) {
    logApiError('[FHIR Bundle/referral GET]', err);
    return serverError();
  }
}
