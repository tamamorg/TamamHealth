'use client';

/**
 * React access to the signed-in user's own role settings.
 *
 * Components read a single setting with `useRoleSetting('queue.sort', '…')`
 * and re-render when it changes — no prop drilling, no reload, and the same
 * value plain modules get from `getRoleSetting()`.
 */
import { useSyncExternalStore } from 'react';
import {
  getRoleSettings,
  subscribeRoleSettings,
} from './role-settings-store';
import type { RoleSettingsValues } from '../role-settings';

/** All of the current user's effective role settings. */
export function useRoleSettings(): RoleSettingsValues {
  return useSyncExternalStore(
    subscribeRoleSettings,
    getRoleSettings,
    // Server render: no user, no localStorage — every consumer falls back.
    () => ({} as RoleSettingsValues),
  );
}

/** One setting, with the fallback used until the store hydrates. */
export function useRoleSetting<T extends boolean | string>(key: string, fallback: T): T {
  const values = useRoleSettings();
  const value = values[key];
  return (value === undefined ? fallback : value) as T;
}

/** Boolean setting — toggles. */
export function useRoleFlag(key: string, fallback: boolean): boolean {
  const value = useRoleSettings()[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** String setting — selects. */
export function useRoleChoice(key: string, fallback: string): string {
  const value = useRoleSettings()[key];
  return typeof value === 'string' && value ? value : fallback;
}
