'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import type { HospitalDoc, OrganizationDoc, UserRole, UserDoc } from './db-types';
import type { OrgBranding } from './branding';
import type { AggregateStatus } from './sync/sync-manager';
// Eagerly bundle the critical login path. These modules are tiny and used at
// the most user-facing flow — lazy-loading them via dynamic import() created
// a separate webpack chunk that could 404 if the browser tab outlived a dev
// rebuild ("Loading chunk _app-pages-browser_src_lib_auth_ts-*.js failed").
import { usersDB } from './db';
import { verifyPassword } from './auth';
import { createToken } from './auth-token';
import { logAudit } from './services/audit-service';
import { captureException } from './observability';
import { CSRF_COOKIE_NAME } from './csrf';

/** True when an error came from a failed dynamic-chunk fetch (stale tab after
 *  a hot-reload, network blip, etc.). The recovery for these is always a
 *  full page reload. */
function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /ChunkLoadError|Loading chunk .*failed|Failed to fetch dynamically imported module/i.test(msg);
}

interface AppUser {
  _id: string;
  username: string;
  name: string;
  role: UserRole;
  /** Real account role when a super-admin is signed in AS another role via
   *  the login role picker; undefined for ordinary sessions. */
  actualRole?: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  hospital?: HospitalDoc;
  /** Staff-directory department. Used to route department-addressed patient
   *  transfers to the right inbox — a transfer sent to "Paediatrics" with no
   *  named provider has nowhere to land without it. */
  department?: string;
  orgId?: string;
  organization?: OrganizationDoc;
  /**
   * Name of the organization the user belongs to, for display.
   *
   * Resolved from the organization document when the device has replicated it,
   * and otherwise from the name stamped on the user's own record. Two sources
   * because either can be missing on its own: the org document is not on every
   * device, and `UserDoc.orgName` is absent on accounts created before it
   * existed. Header and settings read this rather than `organization?.name` so
   * neither gap leaves the org anonymous.
   */
  orgName?: string;
  /** Geographic scope claims propagated from JWT/UserDoc for tier-aware
   *  dashboards (state/county/payam pages, DHIS2 export level picker). */
  payam?: string;
  county?: string;
  state?: string;
  /** True when the user must set a new password before using the app. */
  mustChangePassword?: boolean;
  branding: OrgBranding;
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
async function hydrateAppUser(raw: {
  _id: string; username: string; name: string; role: UserRole;
  hospitalId?: string; orgId?: string; orgName?: string;
  [key: string]: unknown;
}): Promise<AppUser> {
  let hospital: HospitalDoc | undefined;
  if (raw.hospitalId) {
    try {
      const { getHospitalById } = await import('./services/hospital-service');
      const h = await getHospitalById(raw.hospitalId);
      if (h) hospital = h;
    } catch {
      // Not replicated to this device yet — the id/name claims still stand.
    }
  }

  let organization: OrganizationDoc | undefined;
  if (raw.orgId) {
    try {
      const { getOrganizationById } = await import('./services/organization-service');
      const org = await getOrganizationById(raw.orgId);
      if (org) organization = org;
    } catch {
      // Same: absence of the org doc must not block the session.
    }
  }

  const { getOrgBranding, brandingToCSSVars } = await import('./branding');
  const branding = getOrgBranding(organization);
  const vars = brandingToCSSVars(branding);
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value);
  }

  if (organization?.locale) {
    const { initLocaleFromOrg } = await import('./i18n/useTranslation');
    initLocaleFromOrg(organization.locale);
  }

  // Hydrate the user's own role settings before anyone reads them. The login
  // redirect asks for their "Start-up screen" the moment `login()` resolves,
  // which is before the dashboard shell (and PreferenceEffects) has mounted.
  try {
    const { initRoleSettings } = await import('./settings/role-settings-store');
    initRoleSettings(raw._id, raw.role);
  } catch {
    // Defaults stand.
  }

  return {
    ...(raw as unknown as AppUser),
    hospital,
    organization,
    orgName: organization?.name ?? raw.orgName,
    branding,
  };
}

/**
 * Why the server refused the last sign-in attempt.
 *
 * `login()` collapses every failure into `false`, which left the sign-in form
 * labelling a database outage or a lockout as "Invalid credentials" — the one
 * message that tells the user to retype a password that was never wrong.
 */
export interface LoginFailure {
  status: number;
  /** The server's own error text, when it sent one. */
  message?: string;
  /** Seconds until a rate-limited account may try again (from Retry-After). */
  retryAfterSeconds?: number;
}

interface AppState {
  isAuthenticated: boolean;
  currentUser: AppUser | null;
  /** Effective online status: user-preference AND OS-level navigator.onLine */
  isOnline: boolean;
  /** True when the OS reports the network is up (independent of user preference) */
  isNetworkUp: boolean;
  /** True when the user has explicitly paused sync via toggleOnline */
  syncPaused: boolean;
  lastSync: string;
  dbReady: boolean;
  globalSearch: string;
  setGlobalSearch: (s: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  login: (username: string, password: string, hospitalId?: string, requestedRole?: UserRole) => Promise<UserRole | false>;
  /** Why the most recent `login()` returned false, or null if the server was never reached. */
  lastLoginFailure: () => LoginFailure | null;
  logout: () => void;
  /** Re-read the signed-in identity from the server (display name, org,
   *  branding, lock timeout) and re-render every consumer with it. */
  refreshCurrentUser: () => Promise<void>;
  toggleOnline: () => void;
  /** Sync state from the SyncManager (null when sync is disabled) */
  syncStatus: AggregateStatus | null;
  /** Trigger a one-shot sync across all databases */
  syncNow: () => Promise<void>;
}

/** localStorage key for persisting the user's sync on/off preference */
const SYNC_PREFERENCE_KEY = 'tamamhealth.sync.preference';

function readSyncPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(SYNC_PREFERENCE_KEY);
    if (v === 'paused') return false;
    return true;
  } catch {
    return true;
  }
}

function writeSyncPreference(wantsOnline: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SYNC_PREFERENCE_KEY, wantsOnline ? 'online' : 'paused');
  } catch {
    // best-effort
  }
}

const AppContext = createContext<AppState | undefined>(undefined);

/**
 * Sliced contexts (KAN-65 / MED-16).
 *
 * `AppState` bundles values that change at wildly different rates. `syncStatus`
 * ticks while replication runs and `globalSearch` changes on every keystroke,
 * while `currentUser` changes about twice a session. Because they shared one
 * context, a sync tick re-rendered ALL ~119 `useApp()` consumers — including
 * every component that only wanted to know who is logged in.
 *
 * The fix is subscription granularity, not more memoisation: a consumer of
 * `AuthContext` is not subscribed to `SyncContext` and simply does not re-render
 * when sync ticks.
 *
 * `useApp()` still returns the whole merged object so all existing consumers
 * keep working unchanged — it is subscribed to everything by definition, so
 * migrating a component to a narrow hook is what actually buys the saving.
 */

/** Identity + session. Changes on login/logout and little else. */
interface AuthSlice {
  isAuthenticated: boolean;
  currentUser: AppUser | null;
  dbReady: boolean;
  login: AppState['login'];
  lastLoginFailure: AppState['lastLoginFailure'];
  logout: AppState['logout'];
  refreshCurrentUser: AppState['refreshCurrentUser'];
}

/** Replication state. The high-frequency slice. */
interface SyncSlice {
  isOnline: boolean;
  isNetworkUp: boolean;
  syncPaused: boolean;
  lastSync: string;
  syncStatus: AggregateStatus | null;
  syncNow: AppState['syncNow'];
  toggleOnline: AppState['toggleOnline'];
}

/** Chrome state — sidebar and the global search box. Keystroke-frequency. */
interface UiSlice {
  globalSearch: string;
  setGlobalSearch: (s: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const AuthContext = createContext<AuthSlice | undefined>(undefined);
const SyncContext = createContext<SyncSlice | undefined>(undefined);
const UiContext = createContext<UiSlice | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  // User-preference: do they want sync running? Persisted in localStorage.
  const [wantsOnline, setWantsOnline] = useState<boolean>(true);
  // OS-level: is the network actually up?
  const [isNetworkUp, setIsNetworkUp] = useState<boolean>(true);
  const [lastSync, setLastSync] = useState('');
  const [dbReady, setDbReady] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [syncStatus, setSyncStatus] = useState<AggregateStatus | null>(null);
  const syncManagerRef = useRef<import('./sync/sync-manager').SyncManager | null>(null);
  // Bumped each time the sync manager is (re)created so the gating effect
  // re-runs once the manager is ready, instead of needing to peek at refs.
  const [managerEpoch, setManagerEpoch] = useState(0);

  // Initialize database and check session
  useEffect(() => {
    const init = async () => {
      // Public booking is the one surface whose visitor is a patient, not a
      // member of staff. It reads exclusively from `/api/booking/*` on the
      // server and never touches the local database, so building one in a
      // stranger's browser would be several megabytes of clinical demo data
      // written to a device that has no business holding any of it.
      const isPublicBooking = typeof window !== 'undefined'
        && window.location.pathname.startsWith('/book');
      if (isPublicBooking) return;

      // Before anything reads or re-seeds the local record: settle what the
      // last session left behind. Two cases, both of them a device holding
      // charts that nobody is signed in to read.
      //
      //   1. A logout whose wipe could not finish (IndexedDB still had the
      //      database open). It was recorded; complete it now.
      //   2. No session cookie at all — expired, cleared, or a tablet that
      //      was simply put down. The data outlived the session it belonged
      //      to, so it goes, except for anything still holding unsynced
      //      writes (local-wipe.ts explains why those are kept).
      //
      // Demo builds are exempt: the seeded dataset is the product there, it
      // contains no real patient, and wiping it on every visit would leave
      // the demo empty.
      const isDemoBuild = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
      const hasSessionCookie = document.cookie.split(';').some(c => {
        const name = c.trim().split('=')[0];
        return name === 'tamamhealth-token' || name === CSRF_COOKIE_NAME;
      });
      if (!isDemoBuild) {
        try {
          const { completePendingWipe, wipeLocalData } = await import('./security/local-wipe');
          await completePendingWipe();
          if (!hasSessionCookie) await wipeLocalData('session-expired');
        } catch {
          // Never block boot on the wipe; the pending flag survives for the
          // next attempt and the route guards still require a login.
        }
      }

      // Seed database on first load (client-side only)
      // In production, seeding only runs if DB is empty (isSeeded check inside seedDatabase)
      try {
        const { seedDatabase } = await import('./db-seed');
        await seedDatabase();
      } catch (err) {
        console.error('[TamamHealth] Database seed error:', err);
      }

      // Check for existing session via cookie (skip API call if no cookie).
      // `tamamhealth-token` is httpOnly on the server-issued (online) login
      // path, so it's invisible to document.cookie — check the readable
      // CSRF cookie (set alongside it) too, or this always misses online
      // sessions and force-logs-out the user on every hard refresh. The
      // offline/PouchDB fallback login sets `tamamhealth-token` itself
      // (non-httpOnly), so that name still needs checking directly.
      if (hasSessionCookie) {
        try {
          const res = await fetch('/api/auth/me');
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              setCurrentUser(await hydrateAppUser(data.user));
              setIsAuthenticated(true);

              // The platform session was restored from cookies, but the
              // CouchDB AuthSession cookie may be gone (host-scoped, shorter
              // life). Re-establish it server-side so replication resumes
              // instead of silently 401-looping for the rest of the session.
              if (
                process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true' &&
                process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED !== 'true'
              ) {
                try {
                  const { refreshCouchSessionFromServer } = await import('./sync/couch-client-auth');
                  await refreshCouchSessionFromServer({ expectedUsername: data.user.username });
                } catch {
                  // Best-effort; offline-first PouchDB still works.
                }
              }
            }
          }
        } catch {
          // Offline - OK
        }
      }

      // Gate route-guarding on dbReady only once the session check above has
      // resolved — flipping this before that finishes lets DashboardLayout's
      // isAuthenticated effect fire on a false negative and bounce a
      // logged-in user to /login (which then redirects to the *default*
      // dashboard, not the page they actually requested).
      setDbReady(true);
    };

    init();

    // Register service worker with a cache-busting version tag so a new
    // deploy forces the browser to fetch and install the new worker instead
    // of serving stale assets from the previous CACHE_NAME. Skipped in local
    // dev — its cache-first strategy for /_next/static/ otherwise serves
    // stale CSS/JS across reloads and fights the dev server's hot-reload.
    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        const buildId = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
        navigator.serviceWorker.register(`/sw.js?v=${buildId}`).catch(() => {});
      } else {
        // A worker registered by an earlier production build/test on this
        // origin (e.g. `next start` on the same port) outlives that session
        // and keeps cache-first-serving stale /_next/static/ + precached
        // pages forever, since dev mode never re-registers to replace it.
        // Clear any leftover registration so dev always hits the live server.
        navigator.serviceWorker.getRegistrations()
          .then(registrations => registrations.forEach(registration => registration.unregister()))
          .catch(() => {});
      }
    }

    // Hydrate user-preference from localStorage so the sync-paused choice
    // survives reloads.
    setWantsOnline(readSyncPreference());

    // Online/offline detection — the OS-level signal. We never auto-resume
    // sync if the user has explicitly paused it; that's checked in the
    // dedicated effect that watches wantsOnline + isNetworkUp.
    const handleOnline = () => {
      setIsNetworkUp(true);
      // Notify service worker to flush sync queue
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage('ONLINE');
      }
    };
    const handleOffline = () => setIsNetworkUp(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsNetworkUp(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Effective online: user wants to be online AND network is up.
  const isOnline = wantsOnline && isNetworkUp;

  // --- Sync lifecycle: create the manager on login, destroy on logout.
  // The actual start/stop based on user preference + network state is handled
  // by the next effect, so a paused user doesn't start sync at all.
  //
  // The dynamic import('./sync/sync-manager') is async, so we have to guard
  // against the case where the user logs out (or switches org) before the
  // import resolves — without an `aborted` flag the .then() body would
  // happily install a zombie manager AFTER the cleanup ran, and the next
  // teardown would never destroy it.
  useEffect(() => {
    let aborted = false;

    if (!isAuthenticated || !currentUser) {
      // Tear down sync when logged out
      if (syncManagerRef.current) {
        import('./sync/sync-manager').then(({ destroySyncManager }) => {
          if (aborted) return;
          destroySyncManager();
          syncManagerRef.current = null;
          setSyncStatus(null);
        });
      }
      return () => { aborted = true; };
    }

    // Create the manager (does not start sync yet — the gating effect below
    // calls startAll() once it confirms the user is online + network is up).
    import('./sync/sync-manager').then(({ createSyncManager, destroySyncManager }) => {
      if (aborted) {
        // The user logged out (or switched orgs) while we were waiting on the
        // dynamic import. Don't install the manager we were about to build —
        // and proactively destroy any singleton that the cleanup path already
        // created/left behind so we don't leak a syncing tab in a logged-out
        // session.
        destroySyncManager();
        return;
      }
      const manager = createSyncManager({
        orgId: currentUser.orgId,
        // Facility entitlement drives a server-side replication selector, so
        // a facility-scoped user's device never receives other facilities' PHI
        // (KAN-95). Previously every user in an org replicated all of it.
        user: {
          role: currentUser.role,
          orgId: currentUser.orgId,
          hospitalId: currentUser.hospitalId,
          // No `facilityIds` yet: there is no per-user multi-facility grant
          // field on the user record, so cross-facility access is currently
          // role-derived only (see MULTI_FACILITY_ROLES). Adding explicit
          // grants needs a field on UserDoc and a screen to manage it.
        },
        onChange: (status) => {
          setSyncStatus(status);
          // Update lastSync from real data
          if (status.lastSync) {
            setLastSync(status.lastSync);
          }
        },
      });
      syncManagerRef.current = manager;
      setSyncStatus(manager.getStatus());
      setManagerEpoch(e => e + 1);
    });

    return () => {
      aborted = true;
      import('./sync/sync-manager').then(({ destroySyncManager }) => {
        destroySyncManager();
        syncManagerRef.current = null;
      });
    };
  // Recreate the manager whenever the effective data entitlement changes.
  // A user switch can keep the same org while changing facility or role; if
  // those keys are omitted, the new session keeps the previous user's CouchDB
  // replication scope until a full reload.
  }, [
    isAuthenticated,
    currentUser?.orgId,
    currentUser?.hospitalId,
    currentUser?.role,
  ]);  

  // --- Sync gating: the manager runs only when the user wants to be online
  // AND the OS reports the network is up. If either drops, stopAll(). When
  // both come back, startAll() and trigger an immediate syncNow().
  //
  // We deliberately do NOT poke setLastSync() here. The previous version
  // wrote `new Date().toISOString()` the instant startAll() was called, which
  // produced a badge reading "Last synced: just now" before any data had
  // actually been replicated (and stayed misleading when this tab landed as
  // a follower with no SyncService running at all). The manager's onChange
  // callback now drives lastSync from real per-DB status updates.
  useEffect(() => {
    if (!isAuthenticated) return;
    const manager = syncManagerRef.current;
    if (!manager) return;

    if (isOnline) {
      if (!manager.isRunning) {
        manager.startAll();
        // Best-effort kickoff — failures surface via per-DB status.
        manager.syncNow().catch(() => {});
      }
    } else {
      if (manager.isRunning) {
        manager.stopAll();
      }
    }
  }, [isOnline, isAuthenticated, managerEpoch]);

  const syncNow = useCallback(async () => {
    if (syncManagerRef.current) {
      await syncManagerRef.current.syncNow();
    }
  }, []);

  // Set whenever /api/auth/login answers non-OK, read by the sign-in form
  // right after a false return. A ref, not state: the form reads it in the
  // same tick it gets the result, before a state update would have landed.
  const loginFailureRef = useRef<LoginFailure | null>(null);
  const lastLoginFailure = useCallback(() => loginFailureRef.current, []);

  const login = useCallback(async (username: string, password: string, hospitalId?: string, requestedRole?: UserRole): Promise<UserRole | false> => {
    loginFailureRef.current = null;
    try {
      const sanitizedUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');

      // Prefer server-side auth (/api/auth/login). The server reads from a
      // static user registry (server-users.ts) so it works even if the
      // browser's PouchDB has not been seeded yet. It also issues the httpOnly
      // cookie in its response, so we don't have to forge it client-side.
      //
      // Only if the request itself fails (offline / network error) do we fall
      // back to the PouchDB-local path so previously-logged-in users can still
      // sign in without connectivity.
      type LoginUser = Pick<UserDoc, '_id' | 'username' | 'name' | 'role' | 'hospitalId' | 'hospitalName' | 'facilityIds' | 'orgId' | 'isActive' | 'passwordHash' | 'mustChangePassword' | 'department'> & { actualRole?: UserRole };
      let user: LoginUser | null = null;
      let usedApi = false;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: sanitizedUsername, password, hospitalId, role: requestedRole }),
        });
        if (res.ok) {
          const body = await res.json();
          user = {
            _id: body.user._id,
            username: body.user.username,
            name: body.user.name,
            role: body.user.role,
            actualRole: body.user.actualRole,
            hospitalId: body.user.hospitalId,
            hospitalName: body.user.hospitalName,
            orgId: body.user.orgId,
            isActive: true,
            passwordHash: '',
            // Without copying this, the ForcePasswordChange gate never fired
            // for online logins — admin-issued temporary passwords were
            // silently accepted as permanent credentials.
            mustChangePassword: body.user.mustChangePassword,
            facilityIds: body.user.facilityIds,
          };
          usedApi = true;

          // Record this device's offline sign-in credential. The server has
          // just authenticated the password, so what we cache is known-good.
          // Without it there is no offline sign-in at all in production: the
          // old fallback read `tamamhealth_users`, which is deliberately not
          // replicated and is purged a few lines below.
          try {
            const signedIn = user;
            const { cacheOfflineCredential } = await import('./offline-credential');
            await cacheOfflineCredential(password, {
              _id: signedIn._id,
              username: signedIn.username,
              name: signedIn.name,
              role: signedIn.role,
              hospitalId: signedIn.hospitalId,
              hospitalName: signedIn.hospitalName,
              facilityIds: signedIn.facilityIds,
              orgId: signedIn.orgId,
            });
          } catch {
            // Offline sign-in stays unavailable until the next online one.
          }

          // v7 hardening: legacy builds replicated the complete users DB,
          // including password/PIN hashes, into IndexedDB. Tenant-database
          // mode removes that replication surface; purge any legacy local copy
          // once an online login proves this device can use the redacted API.
          if (
            process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED === 'true' &&
            process.env.NEXT_PUBLIC_DEMO_MODE !== 'true' &&
            window.localStorage.getItem('tamamhealth.users-cache-purged-v1') !== 'true'
          ) {
            try {
              const { destroyLocalDatabase } = await import('./db');
              await destroyLocalDatabase('tamamhealth_users');
              window.localStorage.setItem('tamamhealth.users-cache-purged-v1', 'true');
            } catch {
              // Try again on the next online login; never claim the purge ran.
            }
          }

          // Establish replication credentials after platform authentication,
          // but do not hold the sign-in button behind CouchDB. The session
          // endpoint provisions a short-lived server-generated credential, so
          // the platform password is never copied into CouchDB and role changes
          // take effect without waiting on the next password login.
          if (
            process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true' &&
            process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED !== 'true'
          ) {
            void import('./sync/couch-client-auth')
              .then(({ refreshCouchSessionFromServer }) => refreshCouchSessionFromServer({
                force: true,
                expectedUsername: sanitizedUsername,
              }))
              .then((ok) => {
                if (!ok) console.warn('[sync] CouchDB session unavailable — offline-only this session');
              })
              .catch((err) => {
                console.warn(`[sync] CouchDB session unavailable — offline-only this session (${err instanceof Error ? err.message : String(err)})`);
              });
          }
        } else {
          // Record why before branching: a 503 falls through to the offline
          // path below and may still end in `false`, and by then the status
          // that explains it is gone.
          let message: string | undefined;
          try {
            const body = await res.json();
            if (typeof body?.error === 'string') message = body.error;
          } catch {
            // Non-JSON body (proxy error page). The status still classifies it.
          }
          const retryAfter = Number(res.headers.get('Retry-After'));
          loginFailureRef.current = {
            status: res.status,
            message,
            retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
          };

          if (res.status === 401 || res.status === 403 || res.status === 429) {
            // Server explicitly rejected — do not fall back silently.
            await logAudit('login_failed', undefined, sanitizedUsername, `API rejected (${res.status})`, false);
            return false;
          }
          // Any other status (500, 502, 503) falls through to the offline path.
        }
      } catch {
        // Network error — fall through to PouchDB.
      }

      // Offline fallback.
      //
      // Two sources, in order of how much they can be trusted:
      //
      //   1. The device credential cached at the last successful ONLINE login
      //      (`offline-credential.ts`). This is the production path — the
      //      users database is not replicated, so nothing else can answer.
      //   2. The local `tamamhealth_users` replica. Only demo builds seed it;
      //      in production it is empty and, under tenant databases, purged.
      //      Kept so the demo roster still signs in with the network off.
      if (!user) {
        const { verifyOfflineCredential } = await import('./offline-credential');
        const cached = await verifyOfflineCredential(sanitizedUsername, password);
        if (cached) {
          // A cached credential already encodes the facility and role the
          // server issued, so the role-picker and hospital checks below —
          // which exist to re-derive them — have nothing left to decide.
          const token = await createToken({
            _id: cached._id,
            username: cached.username,
            role: cached.role,
            name: cached.name,
            hospitalId: cached.hospitalId,
            facilityIds: cached.facilityIds,
            orgId: cached.orgId,
          });
          document.cookie = `tamamhealth-token=${token}; path=/; max-age=${60 * 60 * 24}; samesite=lax${window.location.protocol === 'https:' ? '; secure' : ''}`;
          user = {
            _id: cached._id,
            username: cached.username,
            name: cached.name,
            role: cached.role,
            hospitalId: cached.hospitalId,
            hospitalName: cached.hospitalName,
            facilityIds: cached.facilityIds,
            orgId: cached.orgId,
            isActive: true,
            passwordHash: '',
          };
        }
      }

      if (!user) {
        const db = usersDB();
        let localUser: UserDoc;
        try {
          localUser = await db.get(`user-${sanitizedUsername}`) as UserDoc;
        } catch {
          await logAudit('login_failed', undefined, sanitizedUsername, 'User not found (offline)', false);
          return false;
        }

        if (!localUser.isActive) {
          await logAudit('login_failed', localUser._id, sanitizedUsername, 'Account disabled', false);
          return false;
        }

        const valid = await verifyPassword(password, localUser.passwordHash);
        if (!valid) {
          await logAudit('login_failed', localUser._id, sanitizedUsername, 'Invalid password (offline)', false);
          return false;
        }

        const ROLES_WITHOUT_HOSPITAL = ['super_admin', 'org_admin', 'government'];
        if (!ROLES_WITHOUT_HOSPITAL.includes(localUser.role) && hospitalId && localUser.hospitalId && localUser.hospitalId !== hospitalId) {
          await logAudit('login_failed', localUser._id, sanitizedUsername, 'Hospital mismatch', false);
          return false;
        }

        // Login role picker — offline mirror of the /api/auth/login rules:
        // only a super-admin may sign in as a different role, adopting the
        // demo flagship facility so facility-scoped queries don't fail closed.
        let effective: LoginUser = localUser;
        if (requestedRole && requestedRole !== localUser.role) {
          const { hasRoleRouteConfig } = await import('./role-routes');
          if (localUser.role !== 'super_admin' || !hasRoleRouteConfig(requestedRole)) {
            await logAudit('login_failed', localUser._id, sanitizedUsername, 'Role not assigned (offline)', false);
            return false;
          }
          const needsFacility = !['super_admin', 'org_admin', 'government', 'county_health_director'].includes(requestedRole);
          effective = {
            ...localUser,
            role: requestedRole,
            actualRole: localUser.role,
            hospitalId: needsFacility ? (localUser.hospitalId ?? 'hosp-001') : localUser.hospitalId,
            hospitalName: needsFacility ? (localUser.hospitalName ?? 'Juba Teaching Hospital') : localUser.hospitalName,
            orgId: localUser.orgId ?? 'org-moh-ss',
          };
        }

        // Mint a local token + set cookie ourselves since no server call happened.
        const token = await createToken({
          _id: effective._id,
          username: effective.username,
          role: effective.role,
          actualRole: effective.actualRole,
          name: effective.name,
          hospitalId: effective.hospitalId,
          orgId: effective.orgId,
        });
        document.cookie = `tamamhealth-token=${token}; path=/; max-age=${60 * 60 * 24}; samesite=lax${window.location.protocol === 'https:' ? '; secure' : ''}`;

        user = effective;
      }

      await logAudit('login_success', user._id, user.username, usedApi ? 'API login' : 'Offline PouchDB login', true);

      // Shift change on a shared tablet: if the last person to sign in here
      // was somebody else, their ward is still in IndexedDB. Clear it before
      // this session reads or writes over the top of it. Anything holding
      // unsynced writes is kept — the outgoing clinician's work is not this
      // login's to destroy — and sync repopulates whatever this user is
      // entitled to see.
      //
      // Demo builds are exempt: switching roles is the point there, the data
      // is seeded, and no patient in it is real.
      if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
        try {
          const { enforceDeviceUser } = await import('./security/local-wipe');
          const handover = await enforceDeviceUser(user._id);
          if (handover && (!handover.ok || handover.kept.length)) {
            console.warn(
              '[TamamHealth] Previous user data not fully cleared on device handover.',
              { kept: handover.kept, remaining: handover.remaining },
            );
          }
        } catch {
          // Never block a clinician from signing in on a wipe failure; the
          // pending flag carries it to the next boot.
        }
      }

      // Load hospital data
      let hospital: HospitalDoc | undefined;
      if (user.hospitalId) {
        try {
          const { getHospitalById } = await import('./services/hospital-service');
          const h = await getHospitalById(user.hospitalId);
          if (h) hospital = h;
        } catch {
          // OK
        }
      }

      // Load organization data and branding
      let organization: OrganizationDoc | undefined;
      if (user.orgId) {
        try {
          const { getOrganizationById } = await import('./services/organization-service');
          const org = await getOrganizationById(user.orgId);
          if (org) organization = org;
        } catch {
          // OK
        }
      }

      const { getOrgBranding, brandingToCSSVars } = await import('./branding');
      const branding = getOrgBranding(organization);

      // Apply branding CSS variables
      const vars = brandingToCSSVars(branding);
      for (const [key, value] of Object.entries(vars)) {
        document.documentElement.style.setProperty(key, value);
      }

      // Apply org language setting
      if (organization?.locale) {
        const { initLocaleFromOrg } = await import('./i18n/useTranslation');
        initLocaleFromOrg(organization.locale);
      }

      // Geographic claims may live on UserDoc (server augment) or the auth
      // response shape. Read defensively so we still populate them when the
      // server-side login returns them but the local PouchDB record doesn't.
      const geo = user as unknown as {
        payam?: string; county?: string; state?: string; mustChangePassword?: boolean; orgName?: string;
      };
      setCurrentUser({
        _id: user._id,
        username: user.username,
        name: user.name,
        role: user.role as UserRole,
        actualRole: user.actualRole,
        hospitalId: user.hospitalId,
        hospitalName: user.hospitalName,
        hospital,
        department: user.department,
        orgId: user.orgId,
        organization,
        orgName: organization?.name ?? geo.orgName,
        payam: geo.payam,
        county: geo.county,
        state: geo.state,
        mustChangePassword: geo.mustChangePassword,
        branding,
      });
      // Same as the restore path: the login redirect reads the user's
      // "Start-up screen" as soon as this returns.
      try {
        const { initRoleSettings } = await import('./settings/role-settings-store');
        initRoleSettings(user._id, user.role as UserRole);
      } catch {
        // Defaults stand.
      }
      setIsAuthenticated(true);
      return user.role as UserRole;
    } catch (err) {
      console.error('Login error:', err);
      captureException(err, { tag: '[client/login]' });

      // Stale-chunk recovery: this happens when a long-lived browser tab tries
      // to lazy-load a JS chunk that the dev server already rebuilt under a
      // new hash. The fix is always a hard reload — offer it directly.
      if (isChunkLoadError(err)) {
        const reload = confirm(
          'A code update was detected and one of the page resources is out of date. ' +
          'Click OK to reload the page and try again.'
        );
        if (reload) window.location.reload();
        return false;
      }

      // Surface the failure to the caller (the login form renders a friendly
      // message). We intentionally do NOT use a raw alert() or leak the
      // internal error text to the user — diagnostics go to the console and
      // Sentry above.
      return false;
    }
  }, []);

  /**
   * Re-read the signed-in identity from the server and re-render the app with
   * it. `/api/auth/me` hydrates from the live user record (not the JWT), so
   * this picks up a display-name change, a department move, an org rename, a
   * new lock timeout, or fresh branding without a re-login.
   *
   * Call it after any write that changes who the current user is or what
   * organization they belong to. Best-effort by design: offline, or on any
   * server error, the existing identity simply stands — a failed refresh must
   * never sign anyone out mid-shift.
   */
  const refreshCurrentUser = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.user) return;
      setCurrentUser(await hydrateAppUser(data.user));
    } catch {
      // Offline or unreachable — keep the identity we already have.
    }
  }, []);

  const logout = useCallback(() => {
    // Capture the identity before clearing it. The UI must become logged out
    // immediately; network, audit, CouchDB, and IndexedDB cleanup are all
    // best-effort and must never make the logout button appear broken.
    const loggingOutUser = currentUser;
    setIsAuthenticated(false);
    setCurrentUser(null);
    setSyncStatus(null);

    // Clear cookies that are readable by JavaScript immediately. The server
    // request below clears the httpOnly session cookie; this fallback covers
    // offline/demo sessions that minted the token client-side.
    if (typeof document !== 'undefined') {
      document.cookie = 'tamamhealth-token=; Max-Age=0; Path=/; SameSite=Lax';
      document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Strict`;
    }

    void (async () => {
      // Server-side revocation and cookie clearing. A bounded timeout prevents
      // a stalled API request from holding any later cleanup hostage.
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3000);
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            keepalive: true,
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
      } catch {
        // The local session is already invalidated; server cleanup is best-effort.
      }

      try {
        const { dropAllDrafts } = await import('./draft-storage');
        await dropAllDrafts();
      } catch {
        // best-effort
      }

      if (
        process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true' &&
        process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED !== 'true'
      ) {
        try {
          const { logoutCouch, clearCouchCredentials } = await import('./sync/couch-client-auth');
          clearCouchCredentials();
          await logoutCouch();
        } catch {
          // best-effort
        }
      }

      try {
        const { logAudit } = await import('./services/audit-service');
        await logAudit('logout', loggingOutUser?._id, loggingOutUser?.username, 'Logged out', true);
      } catch {
        // best-effort
      }

      // Stop replication before attempting IndexedDB deletion. Do not await the
      // delete: browsers can keep an IndexedDB connection alive temporarily,
      // but that must not delay the visible logout or login screen.
      try {
        const { destroySyncManager } = await import('./sync/sync-manager');
        destroySyncManager();
        syncManagerRef.current = null;
      } catch {
        // best-effort
      }
      // Clear the local record. This used to race a 5s timer against
      // resetAllDatabases(), so on a device where IndexedDB was slow to
      // release its handles the charts simply stayed on disk and nothing
      // said so. wipeLocalData() reports what survived and records it, and
      // the next boot finishes the job. Databases holding writes that never
      // reached the server are kept deliberately — see local-wipe.ts.
      try {
        const { wipeLocalData } = await import('./security/local-wipe');
        const result = await wipeLocalData('logout');
        if (!result.ok || result.kept.length) {
          console.warn(
            '[TamamHealth] Local data not fully cleared on logout.',
            { kept: result.kept, remaining: result.remaining },
          );
        }
      } catch {
        // best-effort — the auth state was already cleared above
      }
    })();
  }, [currentUser]);

  /**
   * Toggle the user's "I want to be online and syncing" preference. This
   * actually pauses/resumes the SyncManager (the gating effect above reacts
   * to wantsOnline) and persists the choice across reloads. The browser's
   * online/offline events still override the preference: if the network is
   * genuinely down, sync stays stopped regardless of preference.
   */
  const toggleOnline = useCallback(() => {
    setWantsOnline(prev => {
      const next = !prev;
      writeSyncPreference(next);
      if (next) setLastSync(new Date().toISOString());
      return next;
    });
  }, []);

  const syncPaused = !wantsOnline;

  // Memoize the context value so consumers (TopBar, Sidebar, every page that
  // calls useApp) don't re-render on each provider render — only when one of
  // these values actually changes. setState setters and the useCallback'd
  // actions are stable, so they don't need to be in the dependency list.
  const authValue = useMemo<AuthSlice>(() => ({
    isAuthenticated, currentUser, dbReady, login, lastLoginFailure, logout, refreshCurrentUser,
  }), [isAuthenticated, currentUser, dbReady, login, lastLoginFailure, logout, refreshCurrentUser]);

  const syncValue = useMemo<SyncSlice>(() => ({
    isOnline, isNetworkUp, syncPaused, lastSync, syncStatus, syncNow, toggleOnline,
  }), [isOnline, isNetworkUp, syncPaused, lastSync, syncStatus, syncNow, toggleOnline]);

  const uiValue = useMemo<UiSlice>(() => ({
    globalSearch, setGlobalSearch,
    sidebarOpen, setSidebarOpen,
    sidebarCollapsed, setSidebarCollapsed,
  }), [globalSearch, sidebarOpen, sidebarCollapsed]);

  // The merged value keeps `useApp()` working for the ~119 existing consumers.
  // It necessarily changes whenever ANY slice does — that is the cost narrow
  // hooks exist to avoid, not a defect here.
  const value = useMemo<AppState>(() => ({
    ...authValue, ...syncValue, ...uiValue,
  }), [authValue, syncValue, uiValue]);

  return (
    <AuthContext.Provider value={authValue}>
      <SyncContext.Provider value={syncValue}>
        <UiContext.Provider value={uiValue}>
          <AppContext.Provider value={value}>
            {children}
          </AppContext.Provider>
        </UiContext.Provider>
      </SyncContext.Provider>
    </AuthContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}

/**
 * Identity only. Prefer this over `useApp()` in any component that just needs
 * to know who is signed in — it will not re-render when sync ticks or the
 * user types in the global search box.
 */
export function useAuth(): AuthSlice {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AppProvider');
  return context;
}

/** Replication state only. For sync badges and offline banners. */
export function useSync(): SyncSlice {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used within AppProvider');
  return context;
}

/** Sidebar + global search only. */
export function useUi(): UiSlice {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used within AppProvider');
  return context;
}
