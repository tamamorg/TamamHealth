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
import { hasRoleRouteConfig } from '@/lib/role-routes';
import { deriveIndexKeyBytes, deriveOrgKeyBytes, orgKeyIdFor } from '@/lib/org-data-cipher';

const CROSS_ORG_ROLES: UserRole[] = ['super_admin', 'government'];

/**
 * Who is issued a key. The key opens every sealed field of the organisation,
 * and every staff role holds PHI on its device (clinical, front desk, billing
 * and records roles all replicate and write catalogued fields), so the gate is
 * "a known staff role", not a shortlist: a role the platform does not define
 * (a retired or forged claim, anything that is not a staff account) is refused.
 * Which RECORDS a key can open on a device is decided by the gateway's facility
 * scoping (lib/sync/read-scope.ts), not by withholding the key.
 */
function mayHoldOrgKey(role: string | undefined): boolean {
  return !!role && hasRoleRouteConfig(role);
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    // The real account decides, as for cross-organisation reach below.
    if (!mayHoldOrgKey(auth.actualRole || auth.role)) {
      void logAuditSafe('ORG_KEY_REFUSED', auth.sub, auth.username, `Organisation key refused for role ${auth.role}`, false, { orgId: auth.orgId });
      return forbidden('This account type is not issued an organisation key');
    }

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
      true,
      { orgId: auth.orgId, hospitalId: auth.hospitalId, role: auth.actualRole || auth.role },
    );
    return NextResponse.json({ orgId: requested, version: 'v1', key, indexKey }, { headers: NO_STORE });
  } catch (err) {
    logApiError('[API /crypto/org-key GET]', err);
    return serverError();
  }
}
