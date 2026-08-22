/**
 * API: /api/account-requests/:id
 * POST — approve or reject one request.
 *
 * Approval creates the account through the same `createUser` an admin uses by
 * hand, so every rule that applies to manual creation applies here: the
 * username shape, the hospital requirement, the uniqueness check, and the
 * temporary-password-then-change flow. The request document is only the paper
 * trail; it is never a second, weaker way to make a user.
 */
import { ADMIN } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { PLATFORM_APPROVAL_ROLES, accountRequestFacilityMatchesOrg, accountRequestRoleNeedsFacility, forbidden, generateTempPassword, getAuthPayload, hasRole, isValidAttestation, logApiError, serverError, tempPasswordLengthFor, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { buildScopeFromAuth } from '@/lib/services/data-scope';
import type { UserRole } from '@/lib/db-types';
import { canDecide, getAccountRequest, recordDecision, suggestUsername } from '@/modules/identity/services/account-request-service';

// The same generator every admin-provisioned credential uses, so an approved
// request produces a password with the shape staff already expect — and one
// that can be read aloud in a clinic with no email.

export const runtime = 'nodejs';

const APPROVER_ROLES = ADMIN;

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, APPROVER_ROLES)) return forbidden();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body.action;
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
    }

    const doc = await getAccountRequest(id);
    // Same answer for "no such request" and "not yours": an approver in one
    // tenant should not be able to probe for another tenant's request ids.
    if (!doc || !canDecide(buildScopeFromAuth(auth), doc)) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (doc.status !== 'pending') {
      return NextResponse.json({ error: `This request was already ${doc.status}` }, { status: 409 });
    }

    const decisionNote = typeof body.decisionNote === 'string' ? body.decisionNote : undefined;

    if (action === 'reject') {
      // No attestation required to say no: refusing access needs no proof of
      // identity, and demanding one would only stop approvers clearing junk.
      await recordDecision(id, 'rejected', { username: auth.username, name: auth.name }, { decisionNote });
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // ── Approval ────────────────────────────────────────────────────────
    // Every field on the request is self-asserted. The approver is the only
    // identity check in the whole flow, and before this there was nowhere to
    // record that they had performed one — so an approval that was verified
    // and an approval that was waved through produced identical evidence.
    // Required, and validated against the list rather than accepted as free
    // text, so the audit trail can be counted rather than read.
    const identityAttestation = body.identityAttestation;
    if (!isValidAttestation(identityAttestation)) {
      return NextResponse.json(
        { error: 'Record how you confirmed this person\'s identity before approving.' },
        { status: 400 },
      );
    }

    // The approver may override the requested role — the person asking says
    // what they do, the administrator decides what they get.
    const grantedRole = (typeof body.role === 'string' ? body.role : doc.requestedRole) as UserRole;

    // Re-check the privileged-role guard against the GRANTED role, not the
    // requested one. Routing already kept platform roles away from org
    // admins, but an org_admin could otherwise approve a request that is
    // legitimately theirs while substituting a national role on the way
    // through — a privilege escalation with a paper trail that looks routine.
    if (auth.role !== 'super_admin' && PLATFORM_APPROVAL_ROLES.includes(grantedRole)) {
      return forbidden('You are not permitted to grant platform or national roles.');
    }

    // An org_admin can only ever create inside their own tenant, whatever the
    // request claims. super_admin may place the account where the request asks.
    const orgId = auth.role === 'super_admin' ? (doc.orgId ?? auth.orgId) : auth.orgId;

    if (grantedRole === 'org_admin' || accountRequestRoleNeedsFacility(grantedRole)) {
      if (!orgId) {
        return NextResponse.json({ error: 'Choose an organization for this account' }, { status: 400 });
      }
      const { getOrganizationById } = await import('@/lib/services/organization-service');
      const organization = await getOrganizationById(orgId);
      if (!organization || organization.isActive === false) {
        return NextResponse.json({ error: 'Choose an active organization for this account' }, { status: 400 });
      }
    }

    let hospitalId = typeof body.hospitalId === 'string' ? body.hospitalId.trim() : doc.hospitalId;
    let hospitalName = typeof body.hospitalName === 'string' ? body.hospitalName.trim() : doc.hospitalName;
    if (accountRequestRoleNeedsFacility(grantedRole)) {
      if (!orgId || !hospitalId) {
        return NextResponse.json({ error: 'Choose a facility for this account' }, { status: 400 });
      }
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      const hospital = await getHospitalById(hospitalId);
      if (!accountRequestFacilityMatchesOrg(hospital, orgId)) {
        return NextResponse.json({ error: 'Choose a facility in this organisation' }, { status: 400 });
      }
      hospitalName = hospital.name;
    } else {
      hospitalId = undefined;
      hospitalName = undefined;
    }

    const { createUser, getAllUsers } = await import('@/modules/identity/services/user-service');
    const existing = await getAllUsers();
    const taken = new Set(existing.map(u => u.username));
    const requested = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const username = requested || suggestUsername(doc.fullName, name => taken.has(name));

    // Long enough for whatever minimum this deployment enforces — otherwise
    // `createUser` rejects the credential this route just generated, and the
    // approver sees a password error for a password they never typed.
    const { getMinPasswordLength } = await import('@/modules/identity/policy/password-policy-server');
    const password = generateTempPassword(tempPasswordLengthFor(await getMinPasswordLength()));
    let created;
    try {
      created = await createUser(
        {
          username,
          password,
          name: doc.fullName,
          role: grantedRole,
          hospitalId,
          hospitalName,
          orgId,
          email: doc.email,
          phone: doc.phone,
        },
        auth.sub,
        auth.username,
      );
    } catch (err) {
      // These are the approver's problem to fix (name taken, missing
      // facility), so hand back what createUser said rather than a 500.
      const message = err instanceof Error ? err.message : 'Could not create the account';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Only close the request once the account exists. If createUser throws,
    // the request stays pending and can be retried; closing first would leave
    // an approved request with no account behind it.
    await recordDecision(
      id, 'approved',
      { username: auth.username, name: auth.name },
      { decisionNote, createdUsername: created.username, identityAttestation },
    );

    // Send the invitation, exactly as `POST /api/users` does for an account an
    // administrator creates by hand.
    //
    // This route used to skip it entirely: it called `createUser` directly and
    // handed the approver a temporary password to relay by phone — to someone
    // who had typed their email address into the form FOR THIS PURPOSE, and
    // whose address has since been verified. Two entry points had already been
    // collapsed onto one write path; this is the same collapse for delivery.
    const { deliverAccountInvite } = await import('@/modules/identity/services/invite-delivery');
    const invitation = await deliverAccountInvite(created);

    // The one and only time this password is readable. It is not stored in
    // plaintext anywhere, and the account cannot be used without changing it.
    // Still returned even when the invitation was delivered: the approver
    // needs a fallback for the mail that never arrives, and `invitation` tells
    // them honestly which situation they are in.
    return NextResponse.json({
      ok: true,
      status: 'approved',
      username: created.username,
      temporaryPassword: password,
      mustChangePassword: true,
      invitation,
    });
  } catch (err) {
    logApiError('POST /api/account-requests/[id]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, {
  action: 'account_request.decide',
  resourceId: (_request, ctx) => ctx?.params?.id,
});
