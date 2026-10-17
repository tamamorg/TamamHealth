import type { HospitalDoc, OrganizationDoc, UserPreferences, UserRole } from '../db-types';
import type { OrgBranding } from '../branding';
import type { AggregateStatus } from '../sync/sync-manager';

export interface AppUser {
  _id: string;
  username: string;
  name: string;
  role: UserRole;
  /** Real account role when a super-admin is signed in AS another role via
   *  the login role picker; undefined for ordinary sessions. */
  actualRole?: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  /** Additional facilities this user is explicitly entitled to work in. */
  facilityIds?: string[];
  hospital?: HospitalDoc;
  /** Staff-directory department. Used to route department-addressed patient
   *  transfers to the right inbox — a transfer sent to "Paediatrics" with no
   *  named provider has nowhere to land without it. */
  department?: string;
  specialtyCode?: import('@/modules/departments').ClinicalSpecialty;
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
  preferences?: UserPreferences;
  /** Role requires a second factor that has not been enrolled yet. */
  branding: OrgBranding;
}

/**
 * The slice of the platform's security policy a browser is given.
 *
 * Deliberately small. `/api/auth/me` sends an allow-list, not the whole
 * config — break-glass and continuity settings are the operator's business.
 */
export interface PlatformClientPolicy {
  /** Idle timeout ceiling, minutes. Nothing may configure a longer one. */
  sessionTimeoutMinutes?: number;
  /** Whether the idle screen lock is mandatory for everyone on this
   *  deployment. Off leaves each user their own switch in Settings. */
  screenLockRequired?: boolean;
}

/**
 * Why the server refused the last sign-in attempt.
 *
 * `login()` collapses every failure into `false`, which left the sign-in form
 * labelling a database outage or a lockout as "Invalid credentials" — the one
 * message that tells the user to retype a password that was never wrong.
 */
export interface LoginFailure {
  /** HTTP status, or `NETWORK_UNREACHABLE` when the device never got a reply. */
  status: number;
  /** The server's own error text, when it sent one. */
  message?: string;
  /**
   * Stable reason code, for refusals the UI must phrase itself.
   *
   * `message` is English prose from the server; this is what a translated
   * form matches on. Only 403 role-picker refusals send one today
   * (`RolePickerRefusal` in `identity/core/login-session.ts`).
   */
  code?: string;
  /** Seconds until a rate-limited account may try again (from Retry-After). */
  retryAfterSeconds?: number;
}

export interface AppState {
  isAuthenticated: boolean;
  currentUser: AppUser | null;
  /** Whether this browser currently has a server-authoritative or local-only session. */
  sessionMode: 'online' | 'offline' | null;
  /** The network returned, but the server session must be renewed before replication can resume. */
  requiresOnlineReauth: boolean;
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
  /** `keepSignedIn` defaults to true — the "Keep me signed in" checkbox on
   *  the login form; false issues a browser-session cookie instead of the
   *  usual 30-day persistent one. See session.ts `applySessionCookies`. */
  login: (username: string, password: string, hospitalId?: string, requestedRole?: UserRole, keepSignedIn?: boolean) => Promise<UserRole | false>;
  /** Deployment-wide policy this client must honour — see `PlatformClientPolicy`. */
  platformPolicy: PlatformClientPolicy;
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

/** Identity + session. Changes on login/logout and little else. */
export interface AuthSlice {
  isAuthenticated: boolean;
  currentUser: AppUser | null;
  sessionMode: AppState['sessionMode'];
  requiresOnlineReauth: boolean;
  dbReady: boolean;
  login: AppState['login'];
  lastLoginFailure: AppState['lastLoginFailure'];
  platformPolicy: AppState['platformPolicy'];
  logout: AppState['logout'];
  refreshCurrentUser: AppState['refreshCurrentUser'];
}

/** Replication state. The high-frequency slice. */
export interface SyncSlice {
  isOnline: boolean;
  isNetworkUp: boolean;
  syncPaused: boolean;
  lastSync: string;
  syncStatus: AggregateStatus | null;
  syncNow: AppState['syncNow'];
  toggleOnline: AppState['toggleOnline'];
}

/** Chrome state — sidebar and the global search box. Keystroke-frequency. */
export interface UiSlice {
  globalSearch: string;
  setGlobalSearch: (s: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}
