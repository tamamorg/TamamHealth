/**
 * API: /api/patients/portal-access — staff-side portal access for a patient.
 *
 * GET  ?patientId=…  — what access this patient has. Never a credential.
 * POST { action: 'enrol' | 'disable', patientId, username? }
 *
 * DELIBERATELY NOT UNDER /api/patient-portal. That whole prefix is public in
 * the Edge proxy — the portal authenticates its own callers with a bearer
 * token and issues its own anti-forgery tokens, so the staff session and CSRF
 * gates are skipped for everything beneath it. This route is the opposite kind
 * of thing: the front desk issuing a key, on a staff session, and it needs
 * every gate an admin action gets. Filed with the other staff patient routes
 * so it inherits them.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog, AUDIT_ACTION_HEADER } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

export const runtime = 'nodejs';

/**
 * Who may hand out portal access.
 *
 * The registration desk, because enrolment happens while the patient is
 * standing there with their appointment card, plus the roles that already run
 * the facility's records. Deliberately NOT every clinical role: issuing a
 * login to somebody else's medical record is an administrative act, and the
 * doctor in the consulting room has no way to check who is at the desk.
 */
const ENROL_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'front_desk', 'central_registration_clerk',
  'clinic_clerk', 'hrio', 'records_hmis_officer', 'medical_superintendent',
  'hospital_manager',
];

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ENROL_ROLES)) return forbidden();

    const patientId = request.nextUrl.searchParams.get('patientId');
    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    const { patientsDB } = await import('@/lib/db');
    const { summarisePortalAccess, suggestPortalUsername } = await import('@/lib/services/patient-portal-enrolment');
    const { filterByScope } = await import('@/lib/services/data-scope');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');

    let patient;
    try {
      patient = await patientsDB().get(patientId) as import('@/lib/db-types').PatientDoc;
    } catch {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    // Tenant barrier. `filterByScope` is the only one this platform has, and
    // a patient id is guessable enough that skipping it here would let one
    // organisation's desk read another's register one id at a time.
    if (filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    return NextResponse.json({
      access: summarisePortalAccess(patient),
      suggestedUsername: suggestPortalUsername(patient),
    });
  } catch (err) {
    logApiError('GET /api/patients/portal-access', err);
    return serverError();
  }
}

async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimited = await checkRateLimit(request, 'portal:enrolment', 20);
    if (rateLimited) return rateLimited;

    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ENROL_ROLES)) return forbidden();

    let body: { action?: string; patientId?: string; username?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    const { patientsDB } = await import('@/lib/db');
    const { filterByScope, buildScopeFromAuth } = await import('@/lib/services/data-scope');
    let patient;
    try {
      patient = await patientsDB().get(body.patientId) as import('@/lib/db-types').PatientDoc;
    } catch {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    if (filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const enrolment = await import('@/lib/services/patient-portal-enrolment');

    if (body.action === 'disable') {
      const ok = await enrolment.disablePortalAccount(body.patientId, auth.username);
      if (!ok) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      const response = NextResponse.json({ ok: true });
      response.headers.set(AUDIT_ACTION_HEADER, 'patient_portal.disable');
      return response;
    }

    if (body.action === 'enrol') {
      const username = typeof body.username === 'string' && body.username.trim()
        ? body.username
        : enrolment.suggestPortalUsername(patient);
      const result = await enrolment.enrolPatientInPortal(body.patientId, username, auth.username);
      if (!result.ok) {
        const message = result.reason === 'username_taken'
          ? 'Another patient already uses that username. Choose a different one.'
          : result.reason === 'invalid_username'
            ? 'Choose a username of at least three letters or numbers.'
            : 'Patient not found';
        return NextResponse.json({ error: message }, { status: result.reason === 'not_found' ? 404 : 400 });
      }
      // The activation code crosses this boundary exactly once, to the staff
      // member standing with the patient. It is not stored in readable form
      // and cannot be shown again — a lost slip means issuing a new one.
      const response = NextResponse.json({ ok: true, ...result.enrolment });
      response.headers.set(AUDIT_ACTION_HEADER, 'patient_portal.enrol');
      return response;
    }

    return NextResponse.json({ error: 'action must be "enrol" or "disable"' }, { status: 400 });
  } catch (err) {
    logApiError('POST /api/patients/portal-access', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'patient_portal.enrolment' });
