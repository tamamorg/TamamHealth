/**
 * API: /api/referrals
 * GET  — List referrals (supports ?patientId=xxx&hospitalId=xxx)
 * POST — Create a new referral, accept a referral, or update status
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'medical_superintendent', 'front_desk',
];
// nutritionist and hospital_manager both hold the /referrals route
// (role-routes.ts) and DOC_WRITE_ROLES.referral (write-permissions.ts) — the
// nutrition dashboard's "Refer" action authors a referral directly. Without
// them here the API guard rejected the write before it ever reached the
// CouchDB validator's own (now-matching) role check.
const CREATE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife', 'medical_superintendent',
  'nutritionist', 'hospital_manager',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllReferrals, getReferralsByPatient, getReferralsByHospital,
    } = await import('@/lib/services/referral-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const hospitalId = url.searchParams.get('hospitalId');
    let referrals;
    if (patientId) {
      const rows = await getReferralsByPatient(patientId);
      referrals = filterByScope(rows, buildScopeFromAuth(auth));
    } else if (hospitalId) {
      const rows = await getReferralsByHospital(hospitalId);
      referrals = filterByScope(rows, buildScopeFromAuth(auth));
    } else {
      const scope = buildScopeFromAuth(auth);
      referrals = await getAllReferrals(scope);
    }
    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a clinician's list view into an error.
    import('@/lib/services/audit-service').then(({ logPhiSearch }) =>
      logPhiSearch(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/referrals' },
        'referral',
        { query: new URL(request.url).searchParams.get('q') || undefined, resultCount: Array.isArray(referrals) ? referrals.length : 0 },
      ),
    ).catch(() => {});
    return NextResponse.json({ referrals, total: referrals.length });
  } catch (err) {
    logApiError('[API /referrals GET]', err);
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
    body = sanitizePayload(body);
    const action = body.action as string;
    // Accept a referral (transfers patient to receiving hospital)
    if (action === 'accept') {
      if (!body.referralId) {
        return NextResponse.json({ error: 'referralId is required' }, { status: 400 });
      }
      const { acceptReferral, getReferralById } = await import('@/lib/services/referral-service');
      const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
      // Tenant guard: without this any CREATE_ROLES caller could accept an
      // arbitrary referralId regardless of org/facility. 404 (not 403) so an
      // out-of-scope id reads identically to a missing one. filterByScope's
      // toOrgId exception (KAN-101) is what still lets the RECEIVING org
      // accept a legitimate inbound cross-org referral here.
      const existingForAccept = await getReferralById(body.referralId as string);
      if (!existingForAccept || filterByScope([existingForAccept], buildScopeFromAuth(auth)).length === 0) {
        return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
      }
      const result = await acceptReferral(body.referralId as string);
      if (!result) return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
      return NextResponse.json({ referral: result });
    }
    // Update status
    if (action === 'update_status') {
      if (!body.referralId || !body.status) {
        return NextResponse.json(
          { error: 'referralId and status are required' },
          { status: 400 }
        );
      }
      const { updateReferralStatus, getReferralById } = await import('@/lib/services/referral-service');
      const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
      // Same tenant guard as accept above.
      const existingForStatus = await getReferralById(body.referralId as string);
      if (!existingForStatus || filterByScope([existingForStatus], buildScopeFromAuth(auth)).length === 0) {
        return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
      }
      const result = await updateReferralStatus(
        body.referralId as string,
        body.status as Parameters<typeof updateReferralStatus>[1],
      );
      if (!result) return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
      return NextResponse.json({ referral: result });
    }
    // Create new referral
    if (!body.patientId || !body.toHospitalId || !body.reason) {
      return NextResponse.json(
        { error: 'patientId, toHospitalId, and reason are required' },
        { status: 400 }
      );
    }
    body.referredBy = body.referredBy || auth.sub;
    body.referredByName = body.referredByName || auth.name;
    if (!body.fromHospitalId && auth.hospitalId) body.fromHospitalId = auth.hospitalId;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client — a caller who belongs to an org always gets that org on the
    // referral, no matter what body.orgId said. A body-supplied orgId is only
    // honoured for a national-role caller (super_admin/government) with no
    // org of their own to stamp.
    if (auth.orgId) {
      body.orgId = auth.orgId;
    } else if (!(auth.role === 'super_admin' || auth.role === 'government')) {
      delete body.orgId;
    }
    const { createReferral } = await import('@/lib/services/referral-service');
    const referral = await createReferral(body as Parameters<typeof createReferral>[0]);
    return NextResponse.json({ referral }, { status: 201 });
  } catch (err) {
    logApiError('[API /referrals POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'referral.create' });
