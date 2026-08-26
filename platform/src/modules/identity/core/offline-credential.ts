'use client';

/**
 * The device's offline sign-in credential.
 *
 * ## Why this exists
 *
 * The platform's central promise is that a clinic keeps working with the
 * network down — and until this module, the one thing it could not do offline
 * was let anybody in.
 *
 * The offline path in `context.tsx` verified the password against the local
 * `tamamhealth_users` replica. That replica is correctly no longer replicated
 * (user documents carry password and PIN hashes, and shipping the whole
 * organisation's to every device was the wrong trade), and tenant-mode builds
 * actively destroy any legacy copy on first online login. So in a real
 * deployment the lookup resolved to "user not found" every time. Everything
 * downstream worked offline; the front door did not.
 *
 * ## What is stored, and why it is a smaller exposure than what it replaces
 *
 * One record, for the one person who last signed in on this device:
 *
 *   - a bcrypt hash of their password, computed here from the plaintext they
 *     just typed — the server never sends a hash back;
 *   - the session claims needed to mint a local token (id, role, facility, org);
 *   - when it was cached.
 *
 * That is strictly less than the replicated users database it replaces: one
 * account instead of every account in the organisation, and no PIN hashes.
 *
 * Three limits keep it honest:
 *
 *   - **One user.** Caching a second overwrites the first, so a shared tablet
 *     only ever holds the current clinician.
 *   - **It expires.** After `OFFLINE_CREDENTIAL_TTL_DAYS` the record is refused
 *     and cleared, so a device that walks out of the clinic stops being a way
 *     in. Every online sign-in renews it.
 *   - **It is cleared with everything else** — on logout, on session expiry,
 *     and on device handover (see `security/local-wipe.ts`).
 *
 * bcrypt is deliberate: the attacker model here is someone holding the device
 * and reading localStorage, and a fast hash would hand them the password
 * itself, which people reuse.
 */

import bcrypt from 'bcryptjs';
import type { UserRole } from '@/lib/db-types';

const STORAGE_KEY = 'tamamhealth.offline-credential.v1';
const IS_BROWSER = typeof window !== 'undefined';

/** How long a cached credential stays usable without an online sign-in. */
export const OFFLINE_CREDENTIAL_TTL_DAYS = 30;

/** Session claims needed to rebuild a token offline. Never includes PHI. */
export interface OfflineCredentialClaims {
  _id: string;
  username: string;
  name: string;
  role: UserRole;
  actualRole?: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  facilityIds?: string[];
  orgId?: string;
  department?: string;
  countryId?: string;
  payam?: string;
  county?: string;
  state?: string;
  mustChangePassword?: boolean;
}

interface StoredCredential {
  username: string;
  /** bcrypt hash of the password, computed on this device. */
  verifier: string;
  claims: OfflineCredentialClaims;
  cachedAt: string;
}

function read(): StoredCredential | null {
  if (!IS_BROWSER) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCredential;
    if (!parsed?.username || !parsed?.verifier || !parsed?.claims) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Remove the cached credential. Safe to call when there is none. */
export function clearOfflineCredential(): void {
  if (!IS_BROWSER) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode). Nothing was stored either, so the
    // absence this function promises already holds.
  }
}

function isExpired(credential: StoredCredential): boolean {
  const cachedAt = Date.parse(credential.cachedAt);
  if (!Number.isFinite(cachedAt)) return true;
  const ageDays = (Date.now() - cachedAt) / 86_400_000;
  return ageDays > OFFLINE_CREDENTIAL_TTL_DAYS;
}

/**
 * Record this device's offline credential after a successful ONLINE sign-in.
 *
 * Only ever called on the online path: the server has just authenticated the
 * password, so what is cached is known-good rather than self-asserted.
 *
 * Never throws — a device that cannot cache is a device that cannot sign in
 * offline later, which is a degradation, not a reason to fail the sign-in the
 * user is currently completing.
 */
export async function cacheOfflineCredential(
  password: string,
  claims: OfflineCredentialClaims,
): Promise<void> {
  if (!IS_BROWSER) return;
  try {
    const stored: StoredCredential = {
      username: claims.username,
      // Cost 10 rather than the server's 12: this runs on the sign-in path on
      // low-end field tablets, and the work factor still puts an offline
      // dictionary attack far beyond the value of one clinician's session.
      verifier: await bcrypt.hash(password, 10),
      claims,
      cachedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Quota, private mode, or a crypto failure. Offline sign-in stays
    // unavailable until the next successful online one.
  }
}

/** Whether a usable credential exists — for the UI to explain what offline can do. */
export function hasOfflineCredential(username?: string): boolean {
  const stored = read();
  if (!stored || isExpired(stored)) return false;
  return username ? stored.username === username : true;
}

/**
 * Verify a password offline. Returns the session claims, or null.
 *
 * Null covers every failure the caller should treat identically: no cached
 * credential, a different user, an expired record, or a wrong password.
 */
export async function verifyOfflineCredential(
  username: string,
  password: string,
): Promise<OfflineCredentialClaims | null> {
  const stored = read();
  if (!stored) return null;
  if (stored.username !== username) return null;
  if (isExpired(stored)) {
    // Refusing but keeping it would leave a stale hash on the device for no
    // benefit; nothing will ever accept it again.
    clearOfflineCredential();
    return null;
  }
  try {
    const ok = await bcrypt.compare(password, stored.verifier);
    return ok ? stored.claims : null;
  } catch {
    return null;
  }
}
