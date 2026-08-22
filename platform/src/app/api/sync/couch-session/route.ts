/**
 * API: POST /api/sync/couch-session
 *
 * Re-establishes a browser CouchDB session after a page reload / session
 * restore, where the platform JWT is present but the CouchDB AuthSession
 * cookie is gone (host-scoped, and shorter-lived than the 8h JWT).
 *
 * The interactive login flow provisions the CouchDB user with the user's own
 * password and the browser then POSTs /_session with it. On restore we no
 * longer hold that password, so this route — running with admin credentials —
 * rotates the CouchDB user to a fresh single-use secret and returns it. The
 * browser immediately exchanges it at /_session (see couch-client-auth.ts) and
 * discards it. The secret never touches storage and is useless without the
 * already-authenticated platform session that minted it.
 *
 * Without this, replication silently 401-loops for the rest of the session
 * after any reload, and locally-entered data never pushes to CouchDB.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, logApiError, serverError, unauthorized } from '@/modules/identity';
import { randomBytes } from 'node:crypto';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    if (process.env.NEXT_PUBLIC_SYNC_ENABLED !== 'true') {
      return NextResponse.json({ enabled: false });
    }
    if (process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED === 'true') {
      return NextResponse.json({ enabled: true, gateway: true });
    }

    // A fresh, single-use CouchDB password. The browser uses it once at
    // /_session and then holds only the resulting cookie.
    const ephemeralPassword = randomBytes(24).toString('base64url');

    const { ensureCouchUser } = await import('@/lib/sync/couch-auth');
    await ensureCouchUser({
      username: auth.username,
      password: ephemeralPassword,
      orgId: auth.orgId,
      hospitalId: auth.hospitalId,
      facilityIds: auth.facilityIds,
      platformRole: auth.role,
    });

    return NextResponse.json({
      enabled: true,
      username: auth.username,
      password: ephemeralPassword,
    });
  } catch (err) {
    logApiError('[API /sync/couch-session POST]', err);
    return serverError();
  }
}
