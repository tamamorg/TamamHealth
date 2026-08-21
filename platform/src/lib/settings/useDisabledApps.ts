'use client';

/**
 * React binding for the module toggles in System Administration → Manage Apps.
 *
 * Kept apart from `disabled-apps.ts` so that module stays framework-free: it is
 * imported by `ehr-navigation.ts`, which server components pull in, and a
 * `'use client'` there would drag a client boundary along with it.
 */
import { useSyncExternalStore } from 'react';
import { getDisabledAppRoutes, subscribeDisabledApps } from './disabled-apps';

/** Stable server-render value; a fresh array each call would loop the store. */
const EMPTY: string[] = [];

/** Re-renders the caller when a module is switched on or off. */
export function useDisabledAppRoutes(): string[] {
  return useSyncExternalStore(subscribeDisabledApps, getDisabledAppRoutes, () => EMPTY);
}
