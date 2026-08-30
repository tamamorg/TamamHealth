/**
 * useAutoLock: the idle auto-lock env gate, the platform idle-minutes ceiling
 * actually reaching the timer, and the PBKDF2 PIN scheme — register/verify
 * round-trip, discarding a legacy (pre-PBKDF2) hash rather than verifying
 * against it, and refusing PIN unlock outright on a context that cannot hash
 * one at all (no `crypto.subtle`), rather than falling back to anything
 * weaker.
 *
 * Rendered through a real component — this repo has no React Testing
 * Library, so hooks are exercised via `createRoot`/`act`, the same pattern
 * `useUnsavedChangesWarning.test.tsx` uses.
 *
 * `NEXT_PUBLIC_AUTO_LOCK_DISABLED` is read live (see `isAutoLockDisabled` in
 * the hook) rather than baked into a module-scope constant specifically so
 * this file can flip it per-test without `jest.resetModules()` — resetting
 * the module registry would also reload React itself for the freshly
 * required hook, and a component tree built from one React copy cannot use
 * hooks whose dispatcher lives in a different copy ("Invalid hook call").
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import {
  useAutoLock, hasLockPin, setLockPin, pinHashingSupported, clearLockPin,
} from '@/lib/hooks/useAutoLock';
import { setSettings } from '@/lib/settings/settings-store';
import { DEFAULT_FACILITY_SETTINGS } from '@/lib/settings/facility-settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PIN_HASH_KEY = 'tamamhealth-pin-hash';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  // Facility default (`lockTimeoutMinutes: 2`) would otherwise outrank the
  // platform-ceiling value these tests pass in — zero it so "nothing but the
  // platform is configured" is actually true.
  setSettings({ ...DEFAULT_FACILITY_SETTINGS, lockTimeoutMinutes: 0 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSettings(DEFAULT_FACILITY_SETTINGS);
  delete process.env.NEXT_PUBLIC_AUTO_LOCK_DISABLED;
  jest.useRealTimers();
  jest.restoreAllMocks();
  clearLockPin();
});

type HookResult = ReturnType<typeof useAutoLock>;

function mountHarness(...args: Parameters<typeof useAutoLock>): { latest: () => HookResult } {
  let latest!: HookResult;
  function Harness() {
    latest = useAutoLock(...args);
    return null;
  }
  act(() => { root.render(<Harness />); });
  return { latest: () => latest };
}

describe('the idle-lock kill switch (NEXT_PUBLIC_AUTO_LOCK_DISABLED)', () => {
  it('never locks — not even after a long idle period — when the flag is "true"', () => {
    process.env.NEXT_PUBLIC_AUTO_LOCK_DISABLED = 'true';
    jest.useFakeTimers();
    // 1-minute platform ceiling: if the kill switch were not honoured, this
    // would lock well inside the 10 minutes advanced below.
    const { latest } = mountHarness(true, undefined, 1);
    act(() => { jest.advanceTimersByTime(10 * 60_000); });
    expect(latest().isLocked).toBe(false);
  });

  it('locks after the idle timeout once the flag is unset (the regression this restores)', () => {
    // This is the exact bug: the flag was hardcoded `true` with the
    // env-driven line commented out, so screen locking never engaged
    // regardless of environment.
    delete process.env.NEXT_PUBLIC_AUTO_LOCK_DISABLED;
    jest.useFakeTimers();
    const { latest } = mountHarness(true, undefined, 1);
    expect(latest().isLocked).toBe(false);
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(latest().isLocked).toBe(true);
  });
});

describe('the platform sessionTimeoutMinutes ceiling reaches the actual timer', () => {
  it('locks at exactly the platform minute count when nothing else is configured', () => {
    jest.useFakeTimers();
    const { latest } = mountHarness(true, undefined, 2);
    expect(latest().timeoutMs).toBe(2 * 60_000);
    act(() => { jest.advanceTimersByTime(2 * 60_000 - 1); });
    expect(latest().isLocked).toBe(false);
    act(() => { jest.advanceTimersByTime(1); });
    expect(latest().isLocked).toBe(true);
  });

  it('caps a looser org value down to the platform ceiling', () => {
    jest.useFakeTimers();
    // Org says 30 minutes; the platform operator's ceiling is stricter and
    // must win — this is the rule useAutoLock.getTimeout documents as
    // "every layer below is capped by the platform's own value".
    const { latest } = mountHarness(true, 30, 2);
    expect(latest().timeoutMs).toBe(2 * 60_000);
  });
});

describe('the screen-lock PIN (PBKDF2-SHA256, per-user salt)', () => {
  it('registers a PIN and verifies the exact round trip', async () => {
    const { latest } = mountHarness(true);
    expect(latest().hasPin).toBe(false);

    await act(async () => { await latest().setPin('4471'); });
    expect(latest().hasPin).toBe(true);

    // The stored record is versioned JSON with a random salt, not a bare
    // hash — this is the artefact PBKDF2-with-a-per-user-salt produces, and
    // what distinguishes it from the retired single-round-SHA-256 scheme.
    const stored = JSON.parse(localStorage.getItem(PIN_HASH_KEY)!);
    expect(stored.v).toBe(2);
    expect(typeof stored.salt).toBe('string');
    expect(stored.iterations).toBeGreaterThanOrEqual(100_000);

    await expect(latest().verifyPin('4471')).resolves.toBe(true);
    await expect(latest().verifyPin('0000')).resolves.toBe(false);
  });

  it('gives two different users (two devices) two different salts for the same PIN', async () => {
    await setLockPin('1234');
    const first = JSON.parse(localStorage.getItem(PIN_HASH_KEY)!);
    clearLockPin();
    await setLockPin('1234');
    const second = JSON.parse(localStorage.getItem(PIN_HASH_KEY)!);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('discards a legacy hash instead of ever verifying against it', async () => {
    // The retired 32-bit toy-hash format from the non-secure-context
    // fallback this PR removes — not JSON, so parseStoredPin rejects it.
    localStorage.setItem(PIN_HASH_KEY, 'fb-1a2b3c4d');
    expect(hasLockPin()).toBe(false);
    // Discarded outright, not merely ignored — it must never be read again.
    expect(localStorage.getItem(PIN_HASH_KEY)).toBeNull();

    const { latest } = mountHarness(true);
    expect(latest().hasPin).toBe(false);
    // "No usable PIN" reads as "accept any input" (existing contract for a
    // device that never registered one) — never as "verify against the
    // legacy value".
    await expect(latest().verifyPin('0000')).resolves.toBe(true);
  });

  it('also discards the even older single-round-SHA-256-with-a-static-salt hex format', () => {
    localStorage.setItem(PIN_HASH_KEY, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    expect(hasLockPin()).toBe(false);
    expect(localStorage.getItem(PIN_HASH_KEY)).toBeNull();
  });
});

describe('a non-secure context (no crypto.subtle)', () => {
  const originalCrypto = globalThis.crypto;

  function makeCryptoSubtleUnavailable(): void {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, writable: true, configurable: true });
  });

  it('pinHashingSupported() is false and setLockPin refuses rather than falling back', async () => {
    makeCryptoSubtleUnavailable();
    expect(pinHashingSupported()).toBe(false);
    await expect(setLockPin('1234')).rejects.toThrow(/secure connection/i);
    // Nothing was written — a rejected setup must not leave a half-registered
    // (or worse, weakly-hashed) PIN behind.
    expect(localStorage.getItem(PIN_HASH_KEY)).toBeNull();
  });

  it("the hook reports pinSupported:false and verifyPin refuses an existing PIN outright", async () => {
    // Registered while crypto.subtle WAS available — e.g. this device was
    // provisioned over HTTPS and is now being reached over plain HTTP on a
    // LAN, the scenario `pinHashingSupported`'s doc comment describes.
    await setLockPin('1234');

    makeCryptoSubtleUnavailable();
    const { latest } = mountHarness(true);
    expect(latest().pinSupported).toBe(false);
    // Refuses — it must NOT accept (that would make the lock screen a no-op)
    // and must NOT fall back to a weaker check to decide.
    await expect(latest().verifyPin('1234')).resolves.toBe(false);
  });
});
