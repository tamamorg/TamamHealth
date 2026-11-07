/**
 * Persisted screen-lock state (security audit 2026-11 M4).
 *
 * `isLocked` used to live only in React state, so a reload, a second tab or a
 * browser restart brought the session back unlocked. The lock is now also
 * written to localStorage per user:
 *
 *   - `locked`  the session was locked when last seen (every tab follows it
 *               through the `storage` event, so locking one tab locks all);
 *   - `at`      last activity, so a cold start after the idle window locks
 *               even if the tab died before its timer fired;
 *   - `fails`   consecutive wrong PINs. At MAX_PIN_ATTEMPTS the PIN stops
 *               being accepted and only a password sign-in clears it.
 *
 * Everything is cleared on logout (`clearLockState`), so the next person on a
 * shared tablet starts from nothing and a password sign-in is the reset.
 */

const STATE_PREFIX = 'tamamhealth-lock-state';
export const MAX_PIN_ATTEMPTS = 5;

export interface LockState {
  locked: boolean;
  /** Epoch ms of the last activity or lock/unlock transition. */
  at: number;
  /** Consecutive wrong PIN entries. */
  fails: number;
}

export const lockStateKey = (userId: string) => `${STATE_PREFIX}.${userId}`;
export const isLockStateKey = (key: string | null | undefined): boolean =>
  !!key && key.startsWith(`${STATE_PREFIX}.`);

export function readLockState(userId: string | undefined, now = Date.now()): LockState {
  const empty: LockState = { locked: false, at: now, fails: 0 };
  if (!userId || typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(lockStateKey(userId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<LockState>;
    return {
      locked: parsed.locked === true,
      at: typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? parsed.at : now,
      fails: typeof parsed.fails === 'number' && parsed.fails > 0 ? Math.floor(parsed.fails) : 0,
    };
  } catch {
    return empty;
  }
}

export function writeLockState(userId: string | undefined, patch: Partial<LockState>, now = Date.now()): LockState {
  const next = { ...readLockState(userId, now), ...patch };
  if (!userId || typeof window === 'undefined') return next;
  try {
    window.localStorage.setItem(lockStateKey(userId), JSON.stringify(next));
  } catch {
    // Storage blocked: the in-memory lock still works for this tab.
  }
  return next;
}

/** Forget every user's lock state on this device (logout, handover). */
export function clearLockState(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (isLockStateKey(key)) keys.push(key as string);
    }
    keys.forEach(key => window.localStorage.removeItem(key));
  } catch {
    // Nothing to do; a stale flag only locks the next sign-in once.
  }
}

/**
 * Should a freshly restored session (reload, new tab, reopened browser) start
 * locked? Yes when the lock applies to this user and either it was locked when
 * last seen or the idle window has passed since the last activity.
 */
export function shouldStartLocked(state: LockState, lockEnabled: boolean, timeoutMs: number, now = Date.now()): boolean {
  if (!lockEnabled) return false;
  if (state.locked) return true;
  return now - state.at >= timeoutMs;
}

export function pinLockedOut(state: Pick<LockState, 'fails'>): boolean {
  return state.fails >= MAX_PIN_ATTEMPTS;
}
