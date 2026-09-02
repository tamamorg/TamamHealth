/**
 * Live store for the signed-in user's own role settings.
 *
 * `lib/role-settings.ts` declares WHAT each role can set (the design-11 spec)
 * and persists the chosen values to localStorage. It had no store and no
 * subscribers, so nothing outside the Settings page could read a value and
 * nothing could react when one changed — every toggle on that page saved
 * happily and changed nothing anywhere in the app.
 *
 * This is the missing half, deliberately shaped like `lib/user-prefs.ts` and
 * `lib/settings/settings-store.ts`:
 *
 *   - a singleton of the EFFECTIVE values (role defaults + the user's stored
 *     overrides), so `getRoleSetting()` is correct before anyone has ever
 *     opened Settings and works from plain modules that can't call a hook;
 *   - a subscriber list, so `useRoleSetting()` re-renders on a change made in
 *     this tab, and the `storage` event carries changes from another tab.
 *
 * Scope: per user. localStorage is the offline cache; user-settings-sync
 * persists the same values to the server account so they follow the user.
 * Anything that must hold for a facility belongs in `facility-settings.ts`.
 */
import type { UserRole } from '../db-types';
import {
  specForRole,
  getStoredRoleSettings,
  saveStoredRoleSettings,
  sanitizeRoleSettingsForRole,
  type RoleSettingsValues,
} from '../role-settings';

let currentUserId: string | null = null;
let currentRole: UserRole | null = null;
let current: RoleSettingsValues = {};
const subscribers = new Set<(v: RoleSettingsValues) => void>();

function notify(): void {
  for (const cb of subscribers) {
    try { cb(current); } catch { /* a bad subscriber must not break the others */ }
  }
}

/** Every default declared by this role's spec, keyed by setting id. */
export function roleSettingDefaults(role: UserRole): RoleSettingsValues {
  const defaults: RoleSettingsValues = {};
  for (const section of specForRole(role).sections) {
    for (const row of section.rows) {
      // A `pending` row is declared but not wired (see RoleSettingRow). Serving
      // a default would let a reader believe the setting is in force.
      //
      // This used to test `row.kind === 'toggle' && row.pending`, so the rule
      // held for switches and not for dropdowns: every pending `select` still
      // published its default. `ward.default` served "Maternity",
      // `vitals.critical` served "Every 1 hour", `consult.template` served
      // "SOAP" — each read back as a live value by anything that later asked
      // the store, which is precisely what the comment above forbids. The kind
      // of control was never what made a value trustworthy.
      if ((row.kind === 'toggle' || row.kind === 'select') && row.pending) continue;
      if (row.kind === 'toggle' || row.kind === 'select') defaults[row.key] = row.def;
      else if (row.kind === 'text') defaults[row.key] = row.def;
    }
  }
  return defaults;
}

/**
 * Hydrate the store for a user. Called once per session from
 * `PreferenceEffects`, and again whenever the signed-in user changes.
 */
export function initRoleSettings(userId: string, role: UserRole): void {
  currentUserId = userId;
  currentRole = role;
  const stored = sanitizeRoleSettingsForRole(role, getStoredRoleSettings(userId));
  current = { ...roleSettingDefaults(role), ...stored };
  // Before the dedicated switch existed, "Off" in security.idle was the
  // user's only way to opt out. Preserve that explicit choice for existing
  // accounts instead of letting the new default-on switch silently reverse it.
  if (stored['security.lock'] === undefined && String(stored['security.idle']).toLowerCase() === 'off') {
    current['security.lock'] = false;
  }
  notify();
}

/** Drop the hydrated values (logout). */
export function clearRoleSettings(): void {
  currentUserId = null;
  currentRole = null;
  current = {};
  notify();
}

/** All effective values. */
export function getRoleSettings(): RoleSettingsValues {
  return current;
}

/**
 * One effective value, with a caller-supplied fallback for the case where the
 * store has not hydrated yet (first paint, or a role whose spec omits the key).
 */
export function getRoleSetting<T extends boolean | string>(key: string, fallback: T): T {
  const value = current[key];
  return (value === undefined ? fallback : value) as T;
}

/** Boolean accessor — the common case for toggles. */
export function getRoleFlag(key: string, fallback: boolean): boolean {
  const value = current[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** String accessor — the common case for selects. */
export function getRoleChoice(key: string, fallback: string): string {
  const value = current[key];
  return typeof value === 'string' && value ? value : fallback;
}

/**
 * Merge a patch into the effective values, persist it, and notify subscribers.
 * Persisting only the explicit overrides (not the merged defaults) keeps a
 * later change to a spec default flowing through to users who never touched
 * that row.
 */
export function setRoleSettings(patch: RoleSettingsValues): RoleSettingsValues {
  const accepted = currentRole ? sanitizeRoleSettingsForRole(currentRole, patch) : patch;
  current = { ...current, ...accepted };
  if (currentUserId) {
    saveStoredRoleSettings(currentUserId, { ...getStoredRoleSettings(currentUserId), ...accepted });
  }
  notify();
  return current;
}

/** Replace the stored overrides wholesale (the Settings page's Save button). */
export function replaceRoleSettings(userId: string, values: RoleSettingsValues): void {
  currentUserId = userId;
  const accepted = currentRole ? sanitizeRoleSettingsForRole(currentRole, values) : values;
  saveStoredRoleSettings(userId, accepted);
  // A replacement must drop keys retired by the role spec or left behind by
  // a role change. Merging the old overrides kept those stale values effective
  // until logout, while omitting defaults made unspecified controls disappear.
  current = currentRole ? { ...roleSettingDefaults(currentRole), ...accepted } : { ...accepted };
  notify();
}

/** Reset to this role's defaults, discarding every override. */
export function resetRoleSettings(userId: string, role: UserRole): RoleSettingsValues {
  currentUserId = userId;
  currentRole = role;
  saveStoredRoleSettings(userId, {});
  current = roleSettingDefaults(role);
  notify();
  return current;
}

export function subscribeRoleSettings(cb: (v: RoleSettingsValues) => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
