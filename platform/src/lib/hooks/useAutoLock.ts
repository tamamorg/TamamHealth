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

/**
 * Screen locking is ON by default — a shared clinical device must lock
 * unless an operator explicitly opts out (kiosk-mode hardware with its own
 * physical security, or a controlled test environment). See .env.example.
 *
 * A function rather than a module-scope constant: `NEXT_PUBLIC_*` values are
 * inlined at BUILD time regardless (Next.js's compiler replaces this exact
 * expression with a literal wherever it textually appears), so there is no
 * production difference — but reading it live, rather than once at import,
 * is what lets a test flip the env var and exercise both branches of the
 * SAME hook instance instead of needing a second module registry (which
 * would load a second copy of React and break hooks entirely).
 */
function isAutoLockDisabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTO_LOCK_DISABLED === 'true';
}

/** Fired when the lock PIN is set/cleared so a mounted useAutoLock can update
 *  its `hasPin` state immediately (otherwise it'd be stale until remount). */
export const PIN_CHANGED_EVENT = 'tamamhealth:pin-changed';

/** PBKDF2-SHA256 iteration count. 100k is OWASP's current floor for PBKDF2 —
 *  this runs once per unlock attempt on a local device, not per request, so
 *  the cost is a non-issue against the security gain over a single SHA-256
 *  round with a hardcoded, shared-across-every-install salt. */
const PBKDF2_ITERATIONS = 100_000;
const PIN_SALT_BYTES = 16;
/** Version marker for the stored PIN hash shape. Bumped whenever the scheme
 *  changes so an entry from an older build is recognised as such and
 *  DISCARDED rather than verified against — the whole point of versioning
 *  this is that the old single-round-SHA-256-with-a-static-global-salt
 *  format (and the 32-bit toy hash before it) must never be trusted again,
 *  even to read. A discarded entry just means the user re-registers their
 *  PIN next time the device locks. */
const PIN_HASH_VERSION = 2;

interface StoredPinHash {
  v: typeof PIN_HASH_VERSION;
  /** Base64 of the random per-user salt (see PIN_SALT_BYTES). */
  salt: string;
  /** Base64 of the PBKDF2-derived key. */
  hash: string;
  iterations: number;
}

/**
 * Whether this context can hash a PIN at all. `crypto.subtle` requires a
 * secure context (HTTPS or localhost) — on plain HTTP over a LAN (a phone
 * hitting a facility server by IP) it is undefined.
 *
 * There is deliberately no fallback for the `false` case. The previous
 * behaviour was a 32-bit non-cryptographic hash, which turns a PIN into
 * something a spreadsheet macro can brute-force from the localStorage value
 * alone. Exported so the lock screen can hide the PIN pad entirely and offer
 * only full re-login instead.
 */
export function pinHashingSupported(): boolean {
  return typeof globalThis.crypto !== 'undefined' && !!globalThis.crypto.subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Parses a stored PIN entry, returning `null` for anything that isn't the
 *  CURRENT versioned shape — a legacy hash is malformed JSON (the old format
 *  was a bare hex/`fb-...` string) or lacks the version marker, and either
 *  way must read as "no usable PIN" rather than be handed to a comparison. */
function parseStoredPin(raw: string): StoredPinHash | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPinHash>;
    if (
      parsed && parsed.v === PIN_HASH_VERSION
      && typeof parsed.salt === 'string' && typeof parsed.hash === 'string'
      && typeof parsed.iterations === 'number' && parsed.iterations > 0
    ) {
      return parsed as StoredPinHash;
    }
  } catch {
    // Legacy format wasn't JSON at all.
  }
  return null;
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  // `salt` (from `crypto.getRandomValues`/base64 decoding) types as
  // `Uint8Array<ArrayBufferLike>`, which the DOM lib's `BufferSource` doesn't
  // structurally accept (it wants a concrete `ArrayBuffer`, not the more
  // general `ArrayBufferLike`) — a TS lib-typing mismatch, not a runtime one;
  // WebCrypto accepts any typed array here.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return bytesToBase64(new Uint8Array(bits));
}

/** Whether a screen-lock PIN is currently set on this device AND stored under
 *  the current hashing scheme. A legacy entry is discarded here (rather than
 *  merely ignored) so it can never be read again, by this or a future build. */
export function hasLockPin(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(PIN_HASH_KEY);
  if (!raw) return false;
  if (parseStoredPin(raw)) return true;
  localStorage.removeItem(PIN_HASH_KEY);
  return false;
}

/** Set (or replace) the screen-lock PIN for this device.
 *
 * Throws when this context cannot hash a PIN safely (see
 * `pinHashingSupported`) — callers MUST check that first and not offer PIN
 * setup at all when it is false, rather than catching this to fall back to
 * anything weaker. */
export async function setLockPin(pin: string): Promise<void> {
  if (!pinHashingSupported()) {
    throw new Error('PIN unlock needs a secure connection (HTTPS or localhost) and is unavailable here.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES));
  const hash = await derivePinHash(pin, salt, PBKDF2_ITERATIONS);
  const stored: StoredPinHash = { v: PIN_HASH_VERSION, salt: bytesToBase64(salt), hash, iterations: PBKDF2_ITERATIONS };
  localStorage.setItem(PIN_HASH_KEY, JSON.stringify(stored));
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

export function useAutoLock(
  isAuthenticated: boolean,
  orgLockTimeoutMinutes?: number,
  /**
   * The platform's own `sessionTimeoutMinutes` (Super-admin → Security).
   *
   * A CEILING, not another candidate: it is the strictest layer and it is set
   * by the operator who answers for the whole deployment, so a facility must
   * not be able to configure a longer idle window than the platform allows.
   * The screen has displayed this number since it shipped and nothing read it.
   */
  platformSessionTimeoutMinutes?: number,
) {
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

    // Every layer below is capped by the platform's own value. Applied last
    // and by `Math.min` so it can only ever shorten: a tenant may be stricter
    // than the platform, never looser, and the same rule already governs what
    // an individual may do to their facility's setting.
    const capped = (value: number): number =>
      (platformSessionTimeoutMinutes && platformSessionTimeoutMinutes > 0)
        ? Math.min(value, platformSessionTimeoutMinutes)
        : value;

    if (policyMin !== undefined) {
      const effective = userLockMin && userLockMin > 0 ? Math.min(policyMin, userLockMin) : policyMin;
      return capped(effective) * 60_000;
    }
    if (userLockMin && userLockMin > 0) {
      return capped(userLockMin) * 60_000;
    }
    if (platformSessionTimeoutMinutes && platformSessionTimeoutMinutes > 0) {
      // Nothing else configured: the platform policy IS the answer, rather
      // than falling through to a hard-coded default that ignores it.
      return platformSessionTimeoutMinutes * 60_000;
    }
    if (typeof window === 'undefined') return DEFAULT_TIMEOUT_MS;
    const saved = localStorage.getItem(LOCK_TIMEOUT_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_TIMEOUT_MS;
  }, [facilityLockMin, orgLockTimeoutMinutes, userLockMin, platformSessionTimeoutMinutes]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!isAuthenticated || isAutoLockDisabled()) return;

    timerRef.current = setTimeout(() => {
      setIsLocked(true);
    }, getTimeout());
  }, [isAuthenticated, getTimeout]);

  const lock = useCallback(() => {
    if (isAutoLockDisabled()) return;
    setIsLocked(true);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const unlock = useCallback(() => {
    setIsLocked(false);
    resetTimer();
  }, [resetTimer]);

  /** Verify a PIN against the stored hash. Returns true if valid.
   *
   * Never falls back to the retired weak schemes: a legacy entry is not
   * parseable by `parseStoredPin` and is treated the same as no PIN at all
   * (`hasLockPin` has already discarded it by the time this can be called
   * from `mode === 'unlock'`). On a context that cannot hash at all, this
   * refuses rather than accepting or silently downgrading — the lock screen
   * is expected to not offer PIN entry in that case in the first place. */
  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!hasLockPin()) return true; // No usable PIN set = accept any input
    if (!pinHashingSupported()) return false;
    const stored = parseStoredPin(localStorage.getItem(PIN_HASH_KEY)!)!;
    const candidate = await derivePinHash(pin, base64ToBytes(stored.salt), stored.iterations);
    return candidate === stored.hash;
  }, []);

  /** Set (or update) the user's PIN. Throws on a context that cannot hash one
   *  — see `setLockPin`; callers must gate PIN setup on `pinSupported`. */
  const setPin = useCallback(async (pin: string) => {
    await setLockPin(pin);
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
    if (!isAuthenticated || isAutoLockDisabled()) {
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
    /** Whether this device can hash a PIN at all right now. The lock screen
     *  uses this to decide whether to offer the PIN pad — false means "sign
     *  in again" is the only way to unlock, never a weaker check. */
    pinSupported: pinHashingSupported(),
    lock,
    unlock,
    verifyPin,
    setPin,
    clearPin,
    setTimeoutMs,
    timeoutMs: getTimeout(),
  };
}
