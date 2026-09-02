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
  policyLockMinutes, lockIsMandatory, idleChoiceMinutes,
} from '@/lib/hooks/useAutoLock';
import { setSettings } from '@/lib/settings/settings-store';
import { DEFAULT_FACILITY_SETTINGS } from '@/lib/settings/facility-settings';
import { setRoleSettings, clearRoleSettings } from '@/lib/settings/role-settings-store';

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
  // The role-settings store is a module singleton — a value one test picks
  // would otherwise still be the user's choice in the next.
  clearRoleSettings();
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

  it('never lets the next account on a shared device inherit the previous account PIN', async () => {
    await setLockPin('1234', 'user-a');
    expect(hasLockPin('user-a')).toBe(true);
    expect(hasLockPin('user-b')).toBe(false);
    await setLockPin('5678', 'user-b');
    expect(hasLockPin('user-a')).toBe(true);
    expect(hasLockPin('user-b')).toBe(true);
    clearLockPin('user-a');
    expect(hasLockPin('user-a')).toBe(false);
    expect(hasLockPin('user-b')).toBe(true);
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
    // "No usable PIN" refuses outright — never "verify against the legacy
    // value", and never "accept any input" either. Accepting any input is
    // exactly the auto-lock bypass this hook must not have: a lock screen
    // with no usable PIN is only escapable via a fresh sign-in.
    await expect(latest().verifyPin('0000')).resolves.toBe(false);
  });

  it('also discards the even older single-round-SHA-256-with-a-static-salt hex format', () => {
    localStorage.setItem(PIN_HASH_KEY, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    expect(hasLockPin()).toBe(false);
    expect(localStorage.getItem(PIN_HASH_KEY)).toBeNull();
  });
});

describe('verifyPin refuses when no PIN is registered at all — not "accept any input" (S1)', () => {
  it('returns false, never true, against a device that has never set a PIN', async () => {
    // Auto-lock is on by default, so the very first time a shared device
    // locks there is no PIN yet. verifyPin used to treat that as "nothing to
    // check against, let it through", which meant ANY four digits unlocked a
    // session nobody had actually authenticated into. The only ways in now
    // are a correct pre-existing PIN or a fresh sign-in — see LockScreen's
    // canOfferPinEntry, which keeps this same device from even offering a
    // digit pad in this state.
    expect(hasLockPin()).toBe(false);
    const { latest } = mountHarness(true);
    expect(latest().hasPin).toBe(false);
    await expect(latest().verifyPin('1234')).resolves.toBe(false);
    await expect(latest().verifyPin('0000')).resolves.toBe(false);
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

describe("the user's own \"Auto sign-out after inactivity\" choice", () => {
  it('arms the timer at the chosen minute count when no policy is configured', () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.idle': '5 min' });
    const { latest } = mountHarness(true);
    expect(latest().timeoutMs).toBe(5 * 60_000);
    act(() => { jest.advanceTimersByTime(5 * 60_000); });
    expect(latest().isLocked).toBe(true);
  });

  it("'Off' leaves the session unlocked no matter how long it idles", () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.idle': 'Off' });
    // Nothing else is configured: facility is zeroed in beforeEach and no org
    // or platform value is passed, so this user's choice is the only layer.
    const { latest } = mountHarness(true);
    act(() => { jest.advanceTimersByTime(12 * 60 * 60_000); });
    expect(latest().isLocked).toBe(false);
  });

  it("legacy 'Off' cannot switch off a lock an admin explicitly made mandatory", () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.idle': 'Off' });
    // 2-minute platform ceiling. An individual may shorten a policy window,
    // never cancel one — a shared workstation's protection is not theirs to
    // relax.
    const { latest } = mountHarness(true, undefined, 2, { screenLockRequired: true });
    expect(latest().timeoutMs).toBe(2 * 60_000);
    act(() => { jest.advanceTimersByTime(2 * 60_000); });
    expect(latest().isLocked).toBe(true);
  });
});

describe('the user\'s own screen-lock switch (Settings → Security)', () => {
  it('locks on the chosen window while the switch is on', () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.lock': true, 'security.idle': '5 min' });
    const { latest } = mountHarness(true);
    expect(latest().timeoutMs).toBe(5 * 60_000);
    act(() => { jest.advanceTimersByTime(5 * 60_000); });
    expect(latest().isLocked).toBe(true);
  });

  it('switched off, the session stays open however long it idles', () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.lock': false, 'security.idle': '5 min' });
    const { latest } = mountHarness(true);
    act(() => { jest.advanceTimersByTime(12 * 60 * 60_000); });
    expect(latest().isLocked).toBe(false);
  });

  it('switched off, hiding the tab no longer locks either', () => {
    setRoleSettings({ 'security.lock': false, 'security.idle': '5 min' });
    const { latest } = mountHarness(true);
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(latest().isLocked).toBe(false);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('withdraws the facility window too — that is a default, not a policy', () => {
    jest.useFakeTimers();
    // Every facility ships carrying lockTimeoutMinutes: 2 whether or not
    // anyone chose it. Reading that as policy would mean nobody anywhere
    // could switch their own lock off.
    setSettings({ ...DEFAULT_FACILITY_SETTINGS, lockTimeoutMinutes: 2 });
    setRoleSettings({ 'security.lock': false, 'security.idle': '5 min' });
    const { latest } = mountHarness(true);
    act(() => { jest.advanceTimersByTime(60 * 60_000); });
    expect(latest().isLocked).toBe(false);
  });

  it('still locks on the facility window while the switch is on', () => {
    jest.useFakeTimers();
    setSettings({ ...DEFAULT_FACILITY_SETTINGS, lockTimeoutMinutes: 2 });
    setRoleSettings({ 'security.lock': true, 'security.idle': '30 min' });
    const { latest } = mountHarness(true);
    // Facility outranks the user's longer window, exactly as before.
    expect(latest().timeoutMs).toBe(2 * 60_000);
    act(() => { jest.advanceTimersByTime(2 * 60_000); });
    expect(latest().isLocked).toBe(true);
  });

  it('cannot switch off a lock the operator made mandatory', () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.lock': false, 'security.idle': '5 min' });
    // screenLockRequired is what makes the lock non-negotiable — a shared
    // workstation's protection is not an individual's to withdraw.
    const { latest } = mountHarness(true, undefined, 2, { screenLockRequired: true });
    expect(latest().timeoutMs).toBe(2 * 60_000);
    act(() => { jest.advanceTimersByTime(2 * 60_000); });
    expect(latest().isLocked).toBe(true);
  });

  it('a configured window alone does not make the lock mandatory', () => {
    jest.useFakeTimers();
    // Every install ships sessionTimeoutMinutes: 15 and lockTimeoutMinutes: 2.
    // Treating a shipped default as enforcement would mean the switch never
    // worked anywhere.
    setSettings({ ...DEFAULT_FACILITY_SETTINGS, lockTimeoutMinutes: 2 });
    setRoleSettings({ 'security.lock': false, 'security.idle': '5 min' });
    const { latest } = mountHarness(true, 30, 15);
    act(() => { jest.advanceTimersByTime(60 * 60_000); });
    expect(latest().isLocked).toBe(false);
  });

  it('takes the switch live without a remount', () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.lock': true, 'security.idle': '5 min' });
    const { latest } = mountHarness(true);
    act(() => { setRoleSettings({ 'security.lock': false }); });
    act(() => { jest.advanceTimersByTime(60 * 60_000); });
    expect(latest().isLocked).toBe(false);
  });

  it('an account with no stored switch keeps the lock its window describes', () => {
    jest.useFakeTimers();
    // Every role spec seeds `security.idle`; nothing seeded the switch before
    // it existed, and that must not read as "off".
    setRoleSettings({ 'security.idle': '10 min' });
    const { latest } = mountHarness(true);
    act(() => { jest.advanceTimersByTime(10 * 60_000); });
    expect(latest().isLocked).toBe(true);
  });

  it('preserves the retired Off choice for an account with no stored switch', () => {
    jest.useFakeTimers();
    setRoleSettings({ 'security.idle': 'Off' });
    const { latest } = mountHarness(true, undefined, 2);
    act(() => { jest.advanceTimersByTime(60 * 60_000); });
    expect(latest().isLocked).toBe(false);
  });
});

describe('policyLockMinutes', () => {
  it('is undefined when no admin layer sets a window', () => {
    expect(policyLockMinutes(0, undefined, undefined)).toBeUndefined();
    expect(policyLockMinutes()).toBeUndefined();
  });

  it('prefers the facility window over the org one', () => {
    expect(policyLockMinutes(5, 30)).toBe(5);
    expect(policyLockMinutes(30, 5)).toBe(30);
  });

  it('falls back to the org window when the facility sets none', () => {
    expect(policyLockMinutes(0, 20)).toBe(20);
  });

  it('caps a tenant window at the platform ceiling, never extends it', () => {
    expect(policyLockMinutes(30, undefined, 10)).toBe(10);
    expect(policyLockMinutes(5, undefined, 10)).toBe(5);
  });

  it('is the platform ceiling on its own when nothing else is configured', () => {
    expect(policyLockMinutes(0, 0, 15)).toBe(15);
  });
});

describe('idleChoiceMinutes', () => {
  it('reads a window off the stored choice', () => {
    expect(idleChoiceMinutes('5 min')).toBe(5);
    expect(idleChoiceMinutes('30 min')).toBe(30);
  });

  it('names no window for the retired "Off" choice, so Settings can offer the switch instead', () => {
    expect(idleChoiceMinutes('Off')).toBeUndefined();
    expect(idleChoiceMinutes('off')).toBeUndefined();
  });

  it('names no window for an empty or unparseable value', () => {
    expect(idleChoiceMinutes('')).toBeUndefined();
    expect(idleChoiceMinutes('soon')).toBeUndefined();
    expect(idleChoiceMinutes('0 min')).toBeUndefined();
  });
});

describe('lockIsMandatory', () => {
  it('is true only where the operator explicitly required the lock', () => {
    expect(lockIsMandatory({ screenLockRequired: true })).toBe(true);
  });

  it('is false for a deployment that never set it, so the switch stays a real control', () => {
    expect(lockIsMandatory()).toBe(false);
    expect(lockIsMandatory({})).toBe(false);
    expect(lockIsMandatory({ screenLockRequired: false })).toBe(false);
  });
});
