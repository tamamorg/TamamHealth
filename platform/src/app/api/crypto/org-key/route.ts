/**
 * API: /api/crypto/org-key
 * GET ?orgId= — the caller's organisation data key, for encrypting and
 *               reading replicated fields on this device (lib/org-data-cipher.ts).
 *
 * A member gets their own organisation's key and nothing else. Platform-level
 * accounts (super_admin, government) read across organisations, so they may
 * ask for any organisation's key and for the platform key that covers records
 * with no organisation. Every issue is audited; the response is never cached.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, logApiError, serverError, unauthorized } from '@/modules/identity';
import { logAuditSafe } from '@/lib/services/audit-service';
import type { UserRole } from '@/lib/db-types';
import { deriveIndexKeyBytes, deriveOrgKeyBytes, orgKeyIdFor } from '@/lib/org-data-cipher';

const CROSS_ORG_ROLES: UserRole[] = ['super_admin', 'government'];

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    const requested = new URL(request.url).searchParams.get('orgId') || orgKeyIdFor(auth.orgId);
    // The real account decides cross-org reach, not a role a super-admin is
    // currently viewing the app as.
    const crossOrg = CROSS_ORG_ROLES.includes(auth.actualRole || auth.role);
    const ownKey = orgKeyIdFor(auth.orgId);
    // An account with no organisation writes under the platform key, so that
    // is its "own" key; everyone else is held to their organisation's.
    if (requested !== ownKey && !crossOrg) {
      return forbidden('That organisation key is not issued to this account');
    }

    const b64 = (bytes: Uint8Array) => {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    };
    const key = b64(await deriveOrgKeyBytes(requested));
    // The blind-index key rides along: a device that registers a patient
    // writes the national-ID fingerprint the MPI matches on. It reveals only
    // whether two identifiers are equal, never either one.
    const indexKey = b64(await deriveIndexKeyBytes());

    await logAuditSafe(
      'ORG_KEY_ISSUED', auth.sub, auth.username,
      `Organisation data key ${requested} issued to this device`,
    );
    return NextResponse.json({ orgId: requested, version: 'v1', key, indexKey }, { headers: NO_STORE });
  } catch (err) {
    logApiError('[API /crypto/org-key GET]', err);
    return serverError();
  }
}
