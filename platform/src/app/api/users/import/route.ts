/**
 * API: POST /api/users/import — create many accounts from a staff list.
 *
 * Parsing and validation live in `lib/bulk-user-import.ts`; this route does
 * the two things that need a server: resolving facility NAMES to ids inside
 * the caller's own tenant, and running each row through the SAME `createUser`
 * an administrator uses by hand.
 *
 * That last point is the whole design. Every rule that applies to creating one
 * account applies here — the role guard, the org/facility requirement, the
 * username shape, the uniqueness check, the temporary-password-then-change
 * flow, the invitation. A bulk importer that wrote documents directly would be
 * a second, weaker way to make a user, and it would be the one nobody
 * remembers to update when the rules change.
 *
 * Rows are created ONE AT A TIME and reported individually. A partial import
 * is a real outcome — row 47 has a duplicate username and rows 1-46 are fine —
 * and rolling the whole thing back would make a two-hundred-person go-live
 * hostage to one typo.
 */
import { ADMIN } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, generateTempPassword, getAuthPayload, hasRole, logApiError, parseUserImport, roleNeedsFacility, serverError, tempPasswordLengthFor, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';

export const runtime = 'nodejs';

const WRITE_ROLES = ADMIN;

export interface ImportOutcome {
  line: number;
  name: string;
  username?: string;
  /** Present only when there was no email to invite — the fallback credential. */
  temporaryPassword?: string;
  invited: boolean;
  error?: string;
}

async function postHandler(request: NextRequest) {
  try {
    // Deliberately tighter than the per-account limit: one import is up to 500
    // account creations, each one a bcrypt hash and a mail send.
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimited = await checkRateLimit(request, 'users:import', 5);
    if (rateLimited) return rateLimited;

    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();

    let body: { csv?: string; dryRun?: boolean; orgId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.csv !== 'string' || !body.csv.trim()) {
      return NextResponse.json({ error: 'Paste or upload a staff list first.' }, { status: 400 });
    }

    // An org_admin imports into their own tenant, always — whatever the body
    // says. A super_admin carries no organisation of their own, so they must
    // name the one they are acting inside; "import somewhere" is not a thing
    // this can do, and silently picking a tenant would be worse than refusing.
    const orgId = auth.role === 'super_admin'
      ? (typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : undefined)
      : auth.orgId;
    if (!orgId) {
      return NextResponse.json(
        {
          error: auth.role === 'super_admin'
            ? 'Choose the organization to import into first.'
            : 'Your account is not attached to an organization, so it cannot import staff.',
        },
        { status: 400 },
      );
    }
    if (auth.role === 'super_admin') {
      const { getOrganizationById } = await import('@/lib/services/organization-service');
      const organization = await getOrganizationById(orgId);
      if (!organization || organization.isActive === false) {
        return NextResponse.json({ error: 'Choose an active organization.' }, { status: 400 });
      }
    }

    const [{ getAllHospitals }, { getAllUsersUnscoped }] = await Promise.all([
      import('@/lib/services/hospital-service'),
      import('@/modules/identity/services/user-service'),
    ]);
    const facilities = (await getAllHospitals())
      .filter(h => h.orgId === orgId && h.isActive !== false);
    const existing = await getAllUsersUnscoped();

    const parsed = parseUserImport(body.csv, {
      knownFacilities: facilities.map(h => h.name),
      takenUsernames: existing.map(u => u.username),
      restrictPlatformRoles: auth.role !== 'super_admin',
    });
    if (parsed.fileProblem) {
      return NextResponse.json({ error: parsed.fileProblem }, { status: 400 });
    }

    // A dry run is how the dialog shows what WILL happen before anything does.
    // Same parser, same validation, no writes.
    if (body.dryRun) {
      return NextResponse.json({
        dryRun: true,
        rows: parsed.rows,
        ready: parsed.rows.filter(r => !r.problem).length,
        blocked: parsed.rows.filter(r => r.problem).length,
      });
    }

    const { createUser } = await import('@/modules/identity/services/user-service');
    const { deliverAccountInvite } = await import('@/modules/identity/services/invite-delivery');
    const { getMinPasswordLength } = await import('@/modules/identity/policy/password-policy-server');
    const passwordLength = tempPasswordLengthFor(await getMinPasswordLength());

    const results: ImportOutcome[] = [];
    for (const row of parsed.rows) {
      if (row.problem) {
        results.push({ line: row.line, name: row.name, invited: false, error: row.problem });
        continue;
      }
      const facility = row.facilityName
        ? facilities.find(h => h.name.trim().toLowerCase() === row.facilityName!.trim().toLowerCase())
        : undefined;
      if (roleNeedsFacility(row.role) && !facility) {
        results.push({
          line: row.line,
          name: row.name,
          invited: false,
          error: `No facility called "${row.facilityName ?? ''}" in this organization.`,
        });
        continue;
      }

      const password = generateTempPassword(passwordLength);
      try {
        const created = await createUser(
          {
            username: row.username,
            password,
            name: row.name,
            role: row.role as import('@/lib/db-types').UserRole,
            hospitalId: facility?._id,
            hospitalName: facility?.name,
            orgId,
            email: row.email,
            phone: row.phone,
            department: row.department,
          },
          auth.sub,
          auth.username,
        );
        const invitation = await deliverAccountInvite(created);
        results.push({
          line: row.line,
          name: row.name,
          username: created.username,
          invited: invitation.sent,
          // Returned ONLY when no invitation reached a mailbox. Handing back a
          // list of plaintext credentials for accounts whose owners have
          // already been emailed a link is a needless pile of secrets.
          temporaryPassword: invitation.sent ? undefined : password,
        });
      } catch (err) {
        results.push({
          line: row.line,
          name: row.name,
          invited: false,
          error: err instanceof Error ? err.message : 'Could not create this account.',
        });
      }
    }

    return NextResponse.json({
      created: results.filter(r => r.username).length,
      failed: results.filter(r => r.error).length,
      results,
    });
  } catch (err) {
    logApiError('POST /api/users/import', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'user.bulk_import' });
