'use client';

import type { UserPreferences, UserRole } from '@/lib/db-types';
import { apiFetch } from '@/lib/api-fetch';
import { getStoredRoleSettings, saveStoredRoleSettings } from '@/lib/role-settings';
import { initRoleSettings } from './role-settings-store';
import { getUserPrefs, initUserPrefs, setUserPrefs } from '@/lib/user-prefs';

const pendingKey = (userId: string) => `tamamhealth.preferences.pending.${userId}`;

function readPending(userId: string): UserPreferences | null {
  try {
    const raw = localStorage.getItem(pendingKey(userId));
    return raw ? JSON.parse(raw) as UserPreferences : null;
  } catch { return null; }
}

/** Save locally first, then sync to the authenticated account when online. */
export async function persistUserPreferences(userId: string, preferences: UserPreferences): Promise<boolean> {
  try { localStorage.setItem(pendingKey(userId), JSON.stringify(preferences)); } catch { /* best effort */ }
  try {
    const response = await apiFetch('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    });
    if (!response.ok) return false;
    try { localStorage.removeItem(pendingKey(userId)); } catch { /* best effort */ }
    return true;
  } catch {
    return false;
  }
}

export async function retryPendingUserPreferences(userId: string): Promise<boolean> {
  const pending = readPending(userId);
  return pending ? persistUserPreferences(userId, pending) : true;
}

export async function pullUserPreferences(userId: string, role: UserRole): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/preferences', {
      credentials: 'same-origin', cache: 'no-store',
    });
    if (!response.ok) return false;
    const body = await response.json() as { preferences?: UserPreferences };
    await hydrateUserPreferences(userId, role, body.preferences || {});
    return true;
  } catch { return false; }
}

/** Hydrate server preferences before the dashboard reads its landing page.
 * An unsent offline change wins over the older server copy and is retried. */
export async function hydrateUserPreferences(
  userId: string,
  role: UserRole,
  remote?: UserPreferences,
): Promise<void> {
  const pending = readPending(userId);
  const localRole = getStoredRoleSettings(userId);
  const roleSettings = pending?.roleSettings ?? remote?.roleSettings ?? localRole;
  saveStoredRoleSettings(userId, roleSettings || {});
  initRoleSettings(userId, role);

  initUserPrefs(userId);
  const localUi = getUserPrefs();
  const ui = pending ?? remote;
  if (ui) setUserPrefs({
    density: ui.density ?? localUi.density,
    theme: ui.theme ?? localUi.theme,
  });

  const locale = ui?.locale;
  if (locale) {
    const { applyLocalePreference } = await import('@/lib/i18n/useTranslation');
    await applyLocalePreference(locale);
  }

  if (pending) void persistUserPreferences(userId, pending);
  else if (!remote && (Object.keys(localRole).length > 0 || localUi !== undefined)) {
    // First upgrade from device-only settings: promote the existing choices
    // to the account instead of overwriting them with empty server defaults.
    void persistUserPreferences(userId, {
      roleSettings: localRole,
      density: localUi.density,
      theme: localUi.theme,
    });
  }
}

export function currentUserPreferences(roleSettings: Record<string, boolean | string>, locale: 'en' | 'apd'): UserPreferences {
  const ui = getUserPrefs();
  return { roleSettings, density: ui.density, theme: ui.theme, locale };
}
