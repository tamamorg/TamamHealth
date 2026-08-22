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
 * Scope: per user, per device. These are personal preferences — anything that
 * must hold for everyone at a facility belongs in `facility-settings.ts`,
 * which replicates.
 */
import type { UserRole } from '../db-types';
import {
  specForRole,
  getStoredRoleSettings,
  saveStoredRoleSettings,
  type RoleSettingsValues,
} from '../role-settings';

let currentUserId: string | null = null;
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
      if (row.kind === 'toggle' && row.pending) continue;
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
  current = { ...roleSettingDefaults(role), ...getStoredRoleSettings(userId) };
  notify();
}

/** Drop the hydrated values (logout). */
export function clearRoleSettings(): void {
  currentUserId = null;
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
  current = { ...current, ...patch };
  if (currentUserId) {
    saveStoredRoleSettings(currentUserId, { ...getStoredRoleSettings(currentUserId), ...patch });
  }
  notify();
  return current;
}

/** Replace the stored overrides wholesale (the Settings page's Save button). */
export function replaceRoleSettings(userId: string, values: RoleSettingsValues): void {
  currentUserId = userId;
  saveStoredRoleSettings(userId, values);
  current = { ...current, ...values };
  notify();
}

/** Reset to this role's defaults, discarding every override. */
export function resetRoleSettings(userId: string, role: UserRole): RoleSettingsValues {
  currentUserId = userId;
  saveStoredRoleSettings(userId, {});
  current = roleSettingDefaults(role);
  notify();
  return current;
}

export function subscribeRoleSettings(cb: (v: RoleSettingsValues) => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
