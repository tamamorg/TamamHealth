/**
 * Per-device user preferences (UI choices that aren't security- or
 * facility-policy-level): spacing density and whether to raise desktop
 * notifications for new chat messages.
 *
 * Stored in localStorage (per browser/device, like the theme + lock PIN) and
 * exposed as a tiny reactive store so the Settings page, the density applier,
 * and the notification watcher all stay in sync.
 */

import { getDefaultDashboard, isPathAllowed } from './role-routes';
import { getRoleChoice } from './settings/role-settings-store';

export type Density = 'comfortable' | 'compact';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface UserPrefs {
  /** UI spacing. 'compact' tightens page padding and header spacing. */
  density: Density;
  /** Raise a desktop notification for new chat messages while the tab is hidden. */
  messageNotifications: boolean;
  /**
   * Interface theme. 'system' follows the OS setting live. Default is
   * 'light', not 'system': the platform shipped light-only for years, and a
   * clinician whose personal laptop is dark must opt in rather than find the
   * ward software changed by an OS preference they set for other reasons.
   */
  theme: ThemePreference;
}

const KEY = 'tamamhealth.user-prefs';

export const DEFAULT_USER_PREFS: UserPrefs = {
  density: 'comfortable',
  messageNotifications: false,
  theme: 'light',
};

let cache: UserPrefs | null = null;
const subscribers = new Set<(p: UserPrefs) => void>();

function read(): UserPrefs {
  if (typeof window === 'undefined') return DEFAULT_USER_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_USER_PREFS };
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return { ...DEFAULT_USER_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_USER_PREFS };
  }
}

export function getUserPrefs(): UserPrefs {
  if (!cache) cache = read();
  return cache;
}

export function setUserPrefs(patch: Partial<UserPrefs>): UserPrefs {
  const next = { ...getUserPrefs(), ...patch };
  cache = next;
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* best effort */ }
  }
  // Density and theme are DOM-level concerns — apply immediately so every
  // page reflects them without a reload.
  if (patch.density !== undefined) applyDensity(next.density);
  if (patch.theme !== undefined) applyTheme(next.theme);
  for (const cb of subscribers) { try { cb(next); } catch { /* isolate */ } }
  return next;
}

export function subscribeUserPrefs(cb: (p: UserPrefs) => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/** Reflect the density choice on <html data-density="…"> for CSS to target. */
export function applyDensity(density: Density): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = density;
}

/** The theme a preference resolves to right now ('system' asks the OS). */
export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// One OS-level listener, held only while the preference is 'system' — a
// 'system' user who flips their OS theme sees the app follow live, and a
// 'light'/'dark' user costs nothing.
let systemThemeQuery: MediaQueryList | null = null;
let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

/**
 * Reflect the theme choice on <html data-theme="light|dark"> for CSS to
 * target. The inline script in app/layout.tsx stamps the same attribute from
 * the same stored preference before first paint (no flash); this keeps it
 * correct afterwards, including live OS changes under 'system'.
 */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(pref);
  const wantListener = pref === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  if (wantListener && !systemThemeListener) {
    try {
      systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      systemThemeListener = (e) => { document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'; };
      systemThemeQuery.addEventListener('change', systemThemeListener);
    } catch { systemThemeQuery = null; systemThemeListener = null; }
  } else if (!wantListener && systemThemeListener && systemThemeQuery) {
    try { systemThemeQuery.removeEventListener('change', systemThemeListener); } catch { /* noop */ }
    systemThemeQuery = null;
    systemThemeListener = null;
  }
}

/**
 * The "Start-up screen" options offered on the Settings page (design 11,
 * `accountSection` in lib/role-settings.ts) mapped to the routes they name.
 *
 * Labels rather than routes because the spec is written for the person
 * choosing, not the router. Anything not listed here — including the
 * per-role "My dashboard" / "Facility dashboard" / "Nursing station"
 * entries — falls through to the role's default dashboard.
 */
/**
 * Start-up screen label → route. Exported so the settings specs can be tested
 * against it: a role offered a landing option it cannot enter is a dropdown
 * that silently does nothing, since `resolveLandingPage` falls back instead.
 */
export const LANDING_ROUTES: Record<string, string> = {
  'Patients': '/patients',
  'Appointments': '/appointments',
  'Consultation': '/consultation',
  'Ward board': '/wards',
  'Triage': '/triage',
  'Dispense queue': '/pharmacy',
  'Stock': '/pharmacy',
  'Lab worklist': '/lab',
  'Check-in': '/rooming',
  'Payments': '/payments',
  'Reports': '/reports',
};

/**
 * The page a user should land on after login.
 *
 * Their "Start-up screen" choice wins when they made one and their role may
 * actually enter that route; otherwise the role's default dashboard. The
 * route check matters because the choice outlives a role change — a nurse
 * promoted to pharmacist must not be bounced by the proxy on every sign-in.
 */
export function resolveLandingPage(role: string): string {
  const fallback = getDefaultDashboard(role);
  const choice = getRoleChoice('account.landing', '');
  const route = LANDING_ROUTES[choice];
  if (!route) return fallback;
  return isPathAllowed(role, route) ? route : fallback;
}
