import type { HospitalDoc, OrganizationDoc, UserPreferences, UserRole } from '../db-types';
import { canonicalizeUserRole } from '../user-role';
import type { AppUser } from './types';

/**
 * Where a failed sign-in is filed, and against whom.
 *
 * Nobody is signed in when a sign-in fails, so these rows carried no
 * organisation and never left the device — the server had no record of an
 * offline password-guessing run against an account. The account that was
 * tried is the SUBJECT, not the actor (nobody proved they were that person),
 * and the row is filed under that account's organisation so it replicates the
 * next time anyone at the facility syncs.
 */
export function auditContextFor(target: { _id?: string; orgId?: string; hospitalId?: string } | null | undefined) {
  return { subjectUserId: target?._id, orgId: target?.orgId, hospitalId: target?.hospitalId };
}

/** True when an error came from a failed dynamic-chunk fetch (stale tab after
 *  a hot-reload, network blip, etc.). The recovery for these is always a
 *  full page reload. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /ChunkLoadError|Loading chunk .*failed|Failed to fetch dynamically imported module/i.test(msg);
}

/**
 * Whether platform policy allows a super-admin to sign in as another role.
 *
 * Pure and exported for testing. Mirrors the ONLINE fail-closed rule in
 * `resolveEffectiveIdentity` (modules/identity/core/login-session.ts):
 * `undefined`, `false`, or a policy this device could not read at all must
 * ALL read as "no" — impersonation is the single most powerful thing this
 * platform can do, and a switch that says it is off must never be bypassed
 * because a record was missing rather than explicitly disabled.
 */
export function impersonationAllowedFromPolicy(
  policy: { impersonationEnabled?: boolean } | null | undefined,
): boolean {
  return policy?.impersonationEnabled === true;
}

/**
 * The offline mirror of the login role picker's impersonation gate.
 *
 * `tamamhealth_platform_config` is pull-replicated to every device, globally
 * rather than per-org (see `sync/sync-config.ts`), so a device that has
 * synced at least once usually holds a local copy. One that has not — or
 * whose copy cannot be read for any other reason — fails CLOSED, the same
 * posture `resolveEffectiveIdentity` takes when the server itself cannot
 * reach the config: an unreadable policy must not silently grant the
 * platform's most powerful capability just because the network is down.
 */
export async function isOfflineImpersonationAllowed(): Promise<boolean> {
  try {
    const { getPlatformConfig } = await import('../services/platform-config-service');
    const config = await getPlatformConfig();
    return impersonationAllowedFromPolicy(config.superAdminPolicies);
  } catch {
    return false;
  }
}

/**
 * Turn the raw `/api/auth/me` user payload into the full `AppUser` the app
 * renders from: hospital document, organization document, resolved org name,
 * and the branding whose CSS variables are applied to <html> as a side effect.
 *
 * Extracted so session-restore and `refreshCurrentUser()` build identity
 * exactly the same way. Before this existed, `currentUser` was only ever set
 * at login/restore, so a profile edit (display name), an org rename, a lock
 * timeout change, or a branding change stayed invisible for the rest of the
 * session — the app kept rendering a snapshot taken at sign-in.
 */
export async function hydrateAppUser(raw: {
  _id: string; username: string; name: string; role: UserRole;
  hospitalId?: string; orgId?: string; orgName?: string;
  [key: string]: unknown;
}): Promise<AppUser> {
  const role = canonicalizeUserRole(raw.role);
  let hospital: HospitalDoc | undefined;
  if (raw.hospitalId) {
    try {
      const { getHospitalById } = await import('../services/hospital-service');
      const h = await getHospitalById(raw.hospitalId);
      if (h) hospital = h;
    } catch {
      // Not replicated to this device yet — the id/name claims still stand.
    }
  }

  let organization: OrganizationDoc | undefined;
  if (raw.orgId) {
    try {
      const { getOrganizationById } = await import('../services/organization-service');
      const org = await getOrganizationById(raw.orgId);
      if (org) organization = org;
    } catch {
      // Same: absence of the org doc must not block the session.
    }
  }

  const { getOrgBranding, brandingToCSSVars } = await import('../branding');
  const branding = getOrgBranding(organization);
  const vars = brandingToCSSVars(branding);
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value);
  }

  if (organization?.locale) {
    const { initLocaleFromOrg } = await import('../i18n/useTranslation');
    initLocaleFromOrg(organization.locale);
  }

  // Hydrate account preferences before anyone reads the landing page. The
  // server copy follows the account; an unsent offline change wins and retries.
  try {
    const { hydrateUserPreferences } = await import('../settings/user-settings-sync');
    await hydrateUserPreferences(raw._id, role, raw.preferences as UserPreferences | undefined);
  } catch {
    // Defaults stand.
  }

  return {
    ...(raw as unknown as AppUser),
    role,
    actualRole: raw.actualRole
      ? canonicalizeUserRole(raw.actualRole as UserRole)
      : undefined,
    hospital,
    hospitalName: (raw.hospitalName as string | undefined) || hospital?.name,
    organization,
    orgName: organization?.name ?? raw.orgName,
    branding,
  };
}

/** localStorage key for persisting the user's sync on/off preference */
export const SYNC_PREFERENCE_KEY = 'tamamhealth.sync.preference';
/** Survives reloads until the server confirms the httpOnly session was ended. */
export const LOGOUT_PENDING_KEY = 'tamamhealth.auth.logout-pending';

/**
 * `LoginFailure.status` when the request never reached the server.
 *
 * Not an HTTP status — there was no response to take one from. Zero is what
 * `fetch` failing looks like everywhere else in the platform, and keeping the
 * field a plain number means callers that only test ranges (`>= 500`) still
 * behave.
 */
export const NETWORK_UNREACHABLE = 0;
