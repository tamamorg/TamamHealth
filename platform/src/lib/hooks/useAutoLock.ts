'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSettings, subscribeSettings } from '@/lib/settings/settings-store';
import { getRoleChoice, subscribeRoleSettings } from '@/lib/settings/role-settings-store';

/**
 * Auto-lock hook for shared device security.
 *
 * Behavior:
 *   - Locks IMMEDIATELY when screen turns off / tab hidden (visibilitychange)
 *   - Locks after configurable inactivity timeout (default 1 min)
 *   - Timeout is read from org config (lockTimeoutMinutes) or localStorage
 *   - PIN stored as SHA-256 hash on UserDoc.pinHash
 */

const LOCK_TIMEOUT_KEY = 'tamamhealth-lock-timeout';
const PIN_HASH_KEY = 'tamamhealth-pin-hash';
/** Default idle timeout before auto-lock. 10 minutes balances clinical
 *  workflow (providers don't get locked mid-consult) against shared-device
 *  risk (shift change in a ward). Override via org config or localStorage. */
const DEFAULT_TIMEOUT_MS = 600_000;

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/** TEMPORARY TEST MODE: screen locking is disabled while the platform is being
 * tested. Restore the environment-based flag before production use. */
const AUTO_LOCK_DISABLED = true;
// const AUTO_LOCK_DISABLED = process.env.NEXT_PUBLIC_AUTO_LOCK_DISABLED === 'true';

/** Fired when the lock PIN is set/cleared so a mounted useAutoLock can update
 *  its `hasPin` state immediately (otherwise it'd be stale until remount). */
export const PIN_CHANGED_EVENT = 'tamamhealth:pin-changed';

async function hashPin(pin: string): Promise<string> {
  const salted = pin + 'tamamhealth-salt-2026';
  // Use crypto.subtle when available (HTTPS / localhost)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const buffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for non-secure contexts (HTTP on LAN) — simple hash
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return 'fb-' + Math.abs(hash).toString(16).padStart(8, '0');
}

/** Whether a screen-lock PIN is currently set on this device. */
export function hasLockPin(): boolean {
  return typeof window !== 'undefined' && !!localStorage.getItem(PIN_HASH_KEY);
}

/** Set (or replace) the screen-lock PIN for this device. */
export async function setLockPin(pin: string): Promise<void> {
  localStorage.setItem(PIN_HASH_KEY, await hashPin(pin));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PIN_CHANGED_EVENT));
}

/** Remove the screen-lock PIN from this device. */
export function clearLockPin(): void {
  localStorage.removeItem(PIN_HASH_KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PIN_CHANGED_EVENT));
}

/** "10 min" → 10. Anything unparseable means "no personal preference set". */
function parseIdleChoice(choice: string): number | undefined {
  const match = /^(\d+)/.exec(choice.trim());
  if (!match) return undefined;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
}

export function useAutoLock(isAuthenticated: boolean, orgLockTimeoutMinutes?: number) {
  const [isLocked, setIsLocked] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLockedRef = useRef(false);
  const isAuthRef = useRef(isAuthenticated);
  // Facility setting (from the global settings store) takes precedence over the
  // org value. Kept in React state + subscribed so an admin change to the lock
  // timeout in Facility Settings re-arms the idle timer live.
  const [facilityLockMin, setFacilityLockMin] = useState<number | undefined>(() => getSettings().lockTimeoutMinutes);
  // The user's own "Auto sign-out after inactivity" (`security.idle`, e.g.
  // "10 min"). It may only make the lock STRICTER than facility policy — a
  // shared workstation's protection is not something an individual can relax.
  const [userLockMin, setUserLockMin] = useState<number | undefined>(() => parseIdleChoice(getRoleChoice('security.idle', '')));

  // Keep refs in sync for use in event handlers (avoids stale closures)
  useEffect(() => { isLockedRef.current = isLocked; }, [isLocked]);
  useEffect(() => { isAuthRef.current = isAuthenticated; }, [isAuthenticated]);
  useEffect(() => {
    setFacilityLockMin(getSettings().lockTimeoutMinutes);
    return subscribeSettings(s => setFacilityLockMin(s.lockTimeoutMinutes));
  }, []);
  useEffect(() => {
    setUserLockMin(parseIdleChoice(getRoleChoice('security.idle', '')));
    return subscribeRoleSettings(v => setUserLockMin(parseIdleChoice(String(v['security.idle'] ?? ''))));
  }, []);

  // Check if user has a PIN set — and stay in sync when it changes (e.g. the
  // user sets/removes their PIN from the Settings page, or another tab does).
  useEffect(() => {
    const sync = () => setHasPin(hasLockPin());
    sync();
    if (typeof window === 'undefined') return;
    window.addEventListener(PIN_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PIN_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const getTimeout = useCallback((): number => {
    // Priority: facility setting > org config > localStorage > default, then
    // the user's own choice applied on top — but only where it shortens the
    // timeout. Picking "30 min" on a workstation the facility locks after 2
    // must not extend it.
    const policyMin = (facilityLockMin && facilityLockMin > 0)
      ? facilityLockMin
      : (orgLockTimeoutMinutes && orgLockTimeoutMinutes > 0)
        ? orgLockTimeoutMinutes
        : undefined;
    if (policyMin !== undefined) {
      const effective = userLockMin && userLockMin > 0 ? Math.min(policyMin, userLockMin) : policyMin;
      return effective * 60_000;
    }
    if (userLockMin && userLockMin > 0) {
      return userLockMin * 60_000;
    }
    if (typeof window === 'undefined') return DEFAULT_TIMEOUT_MS;
    const saved = localStorage.getItem(LOCK_TIMEOUT_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_TIMEOUT_MS;
  }, [facilityLockMin, orgLockTimeoutMinutes, userLockMin]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!isAuthenticated || AUTO_LOCK_DISABLED) return;

    timerRef.current = setTimeout(() => {
      setIsLocked(true);
    }, getTimeout());
  }, [isAuthenticated, getTimeout]);

  const lock = useCallback(() => {
    if (AUTO_LOCK_DISABLED) return;
    setIsLocked(true);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const unlock = useCallback(() => {
    setIsLocked(false);
    resetTimer();
  }, [resetTimer]);

  /** Verify a PIN against the stored hash. Returns true if valid. */
  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const storedHash = localStorage.getItem(PIN_HASH_KEY);
    if (!storedHash) return true; // No PIN set = accept any input
    const inputHash = await hashPin(pin);
    return inputHash === storedHash;
  }, []);

  /** Set (or update) the user's PIN */
  const setPin = useCallback(async (pin: string) => {
    const hashed = await hashPin(pin);
    localStorage.setItem(PIN_HASH_KEY, hashed);
    setHasPin(true);
  }, []);

  /** Clear the stored PIN */
  const clearPin = useCallback(() => {
    localStorage.removeItem(PIN_HASH_KEY);
    setHasPin(false);
  }, []);

  /** Update the inactivity timeout (in ms) */
  const setTimeoutMs = useCallback((ms: number) => {
    localStorage.setItem(LOCK_TIMEOUT_KEY, String(ms));
    resetTimer();
  }, [resetTimer]);

  // Activity listeners + visibility change
  useEffect(() => {
    if (!isAuthenticated || AUTO_LOCK_DISABLED) {
      setIsLocked(false);
      return;
    }

    resetTimer();

    const handleActivity = () => {
      if (!isLockedRef.current) resetTimer();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    // Lock IMMEDIATELY when screen goes off or tab is hidden
    const handleVisibility = () => {
      if (document.hidden && isAuthRef.current) {
        lock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isAuthenticated, lock, resetTimer]);

  return {
    isLocked,
    hasPin,
    lock,
    unlock,
    verifyPin,
    setPin,
    clearPin,
    setTimeoutMs,
    timeoutMs: getTimeout(),
  };
}
