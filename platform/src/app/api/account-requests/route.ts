/**
 * API: /api/account-requests
 * POST — public. Someone asks for an account. No session, no account created.
 * GET  — approvers only. The requests this viewer may act on.
 *
 * The POST is deliberately the only unauthenticated write in the app besides
 * login, so it is written to be boring: it stores a claim, grants nothing, and
 * never reports whether the email already has an account. Organisation and
 * facility ids are different: the public form already lists them, so this
 * route validates their relationship before storing the request.
 */
import { ADMIN } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { accountRequestFacilityMatchesOrg, accountRequestRoleNeedsFacility, forbidden, getAuthPayload, hasRole, isRequestableRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { buildScopeFromAuth } from '@/lib/services/data-scope';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-utils';
import { withAuditLog } from '@/lib/audit/with-audit';
import { notifyRequestSubmitted } from '@/modules/identity/services/account-request-notify';
import { createAccountRequest, listAccountRequests } from '@/modules/identity/services/account-request-service';

export const runtime = 'nodejs';

/** Only the two roles that can create an account can approve a request. */
const APPROVER_ROLES = ADMIN;

/**
 * Ten requests per hour per IP. Generous for a clinic behind one NAT address
 * where several staff sign up the same morning, tight enough that the form
 * cannot be used to flood an approver's queue.
 */
const SUBMIT_LIMIT = 10;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Same answer for every outcome — see the note at the top of this file.
 *
 * It now also has to be the same answer whether or not the address already
 * has an account or an open request, which is why it describes what the
 * PERSON should do next rather than what the server did.
 */
const ACCEPTED = {
  ok: true,
  message: 'Check your email and open the confirmation link. '
    + 'Once you confirm your address, an administrator will review your request.',
};

async function postHandler(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const verdict = await rateLimit({
      key: `acctreq:ip:${getClientIp(request)}`,
      limit: SUBMIT_LIMIT,
      windowMs: SUBMIT_WINDOW_MS,
    });
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: 'Too many requests from this connection. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))) } },
      );
    }

    const role = typeof body.requestedRole === 'string' ? body.requestedRole : '';
    if (!isRequestableRole(role)) {
      return NextResponse.json({ error: 'Choose a role from the list' }, { status: 400 });
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const orgId = str(body.orgId)?.trim();
    let orgName = str(body.orgName)?.trim();
    const hospitalId = str(body.hospitalId)?.trim();
    let hospitalName = str(body.hospitalName)?.trim();

    if (accountRequestRoleNeedsFacility(role)) {
      if (!orgId || !hospitalId) {
        return NextResponse.json({ error: 'Choose your organisation and facility' }, { status: 400 });
      }
      const [{ getOrganizationById }, { getHospitalById }] = await Promise.all([
        import('@/lib/services/organization-service'),
        import('@/lib/services/hospital-service'),
      ]);
      const [org, hospital] = await Promise.all([
        getOrganizationById(orgId),
        getHospitalById(hospitalId),
      ]);
      if (!org || org.isActive === false || !accountRequestFacilityMatchesOrg(hospital, orgId)) {
        return NextResponse.json({ error: 'Choose a valid facility for that organisation' }, { status: 400 });
      }
      // Persist canonical names; never trust public clients to bind an id to
      // a different display name.
      orgName = org.name;
      hospitalName = hospital.name;
    }
    try {
      const { doc, verificationToken } = await createAccountRequest({
        fullName: str(body.fullName) ?? '',
        email: str(body.email) ?? '',
        phone: str(body.phone),
        requestedRole: role,
        orgId,
        orgName,
        hospitalId,
        hospitalName,
        note: str(body.note),
        professionalRegistrationNumber: str(body.professionalRegistrationNumber),
      });
      // Ask the address to prove itself. Awaited rather than fired and
      // forgotten, because the answer below is the same either way and a
      // serverless invocation that returns first may never run the tail.
      await notifyRequestSubmitted(doc, verificationToken);
    } catch (err) {
      // Shape problems the person can fix are worth returning; anything else
      // is an internal fault and must not describe the system to a stranger.
      const message = err instanceof Error ? err.message : '';
      if (/required|valid email|from the list/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      logApiError('POST /api/account-requests', err);
      return serverError();
    }

    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (err) {
    logApiError('POST /api/account-requests', err);
    return serverError();
  }
}

/**
 * The one public write in the application, and until now the only mutation
 * that produced no audit row at all. Unauthenticated requests are recorded as
 * `anonymous`, which is precisely the traffic an auditor wants to be able to
 * count after the fact.
 */
export const POST = withAuditLog(postHandler, { action: 'account_request.submit' });

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, APPROVER_ROLES)) return forbidden();

    const status = request.nextUrl.searchParams.get('status');
    const requests = await listAccountRequests(
      buildScopeFromAuth(auth),
      status === 'pending' || status === 'approved' || status === 'rejected' ? { status } : {},
    );
    return NextResponse.json({ requests });
  } catch (err) {
    logApiError('GET /api/account-requests', err);
    return serverError();
  }
}
