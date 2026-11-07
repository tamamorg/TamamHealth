/**
 * Security audit 2026-11 M4: the screen lock must survive a reload, follow
 * every tab, make the app behind it inert, and stop accepting a PIN after
 * five wrong tries.
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useAutoLock, setLockPin, clearLockPin, lockPinLength, NEW_PIN_LENGTH, isValidNewPin } from '@/lib/hooks/useAutoLock';
import { setSettings } from '@/lib/settings/settings-store';
import { DEFAULT_FACILITY_SETTINGS } from '@/lib/settings/facility-settings';
import { clearRoleSettings, setRoleSettings } from '@/lib/settings/role-settings-store';
import {
  readLockState, writeLockState, clearLockState, shouldStartLocked, lockStateKey, MAX_PIN_ATTEMPTS,
} from '@/lib/security/lock-state';
import { inertOutside } from '@/lib/security/inert-outside';
import { canOfferPinEntry } from '@/components/LockScreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  setSettings({ ...DEFAULT_FACILITY_SETTINGS, lockTimeoutMinutes: 0 });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSettings(DEFAULT_FACILITY_SETTINGS);
  clearLockPin('u1');
  clearRoleSettings();
  jest.useRealTimers();
});

function mount(platformMinutes: number | null = 10) {
  let latest!: ReturnType<typeof useAutoLock>;
  function Harness({ minutes }: { minutes: number | null }) {
    latest = useAutoLock(true, undefined, minutes ?? undefined, undefined, 'u1');
    return null;
  }
  act(() => { root.render(<Harness minutes={platformMinutes} />); });
  const get = () => latest;
  get.rerender = (minutes: number | null) => act(() => { root.render(<Harness minutes={minutes} />); });
  return get;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('lock state helpers', () => {
  it('starts locked on a cold restore when last locked, or idle past the window', () => {
    const now = 1_000_000;
    expect(shouldStartLocked({ locked: true, at: now, fails: 0 }, true, 60_000, now)).toBe(true);
    expect(shouldStartLocked({ locked: false, at: now - 61_000, fails: 0 }, true, 60_000, now)).toBe(true);
    expect(shouldStartLocked({ locked: false, at: now - 10_000, fails: 0 }, true, 60_000, now)).toBe(false);
    expect(shouldStartLocked({ locked: true, at: now, fails: 0 }, false, 60_000, now)).toBe(false);
  });

  it('clearLockState forgets every user', () => {
    writeLockState('a', { locked: true });
    writeLockState('b', { fails: 3 });
    clearLockState();
    expect(readLockState('a').locked).toBe(false);
    expect(readLockState('b').fails).toBe(0);
  });
});

describe('cold restore', () => {
  it('a reload after a lock comes back locked', () => {
    writeLockState('u1', { locked: true });
    const latest = mount();
    expect(latest().isLocked).toBe(true);
  });

  it('a restore after the idle window has passed is locked', () => {
    writeLockState('u1', { locked: false, at: Date.now() - 11 * 60_000 });
    expect(mount()().isLocked).toBe(true);
  });

  it('a fresh sign-in with no stored state is not locked', () => {
    expect(mount()().isLocked).toBe(false);
  });

  it('a signed-in user still locks on the idle timer and persists it', () => {
    jest.useFakeTimers();
    const latest = mount();
    act(() => { jest.advanceTimersByTime(10 * 60_000); });
    expect(latest().isLocked).toBe(true);
    expect(readLockState('u1').locked).toBe(true);
  });

  it('locking persists, and another tab locking locks this one', () => {
    const latest = mount();
    act(() => { latest().lock(); });
    expect(readLockState('u1').locked).toBe(true);

    act(() => { latest().unlock(); });
    expect(latest().isLocked).toBe(false);
    expect(readLockState('u1').locked).toBe(false);

    writeLockState('u1', { locked: true });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: lockStateKey('u1'), newValue: '{}' }));
    });
    expect(latest().isLocked).toBe(true);
  });
});

describe('PIN attempt limit', () => {
  it('stops accepting the PIN (even the right one) after five wrong entries', async () => {
    await setLockPin('123456', 'u1');
    const latest = mount();
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      await act(async () => { await expect(latest().verifyPin('000000')).resolves.toBe(false); });
    }
    expect(latest().pinLockedOut).toBe(true);
    await act(async () => { await expect(latest().verifyPin('123456')).resolves.toBe(false); });
    // The lock screen withdraws the keypad.
    expect(canOfferPinEntry(true, true, latest().pinLockedOut)).toBe(false);
  });

  it('a correct PIN before the limit unlocks and resets the count', async () => {
    await setLockPin('123456', 'u1');
    const latest = mount();
    await act(async () => { await latest().verifyPin('000000'); });
    expect(readLockState('u1').fails).toBe(1);
    await act(async () => { await expect(latest().verifyPin('123456')).resolves.toBe(true); });
    act(() => { latest().unlock(); });
    expect(readLockState('u1').fails).toBe(0);
  });

  it('the failure count survives a reload', async () => {
    await setLockPin('123456', 'u1');
    writeLockState('u1', { fails: MAX_PIN_ATTEMPTS, locked: true });
    expect(mount()().pinLockedOut).toBe(true);
  });
});

describe('PIN length', () => {
  it('new PINs are 6 digits; an existing 4-digit PIN keeps working at 4', async () => {
    expect(lockPinLength('u1')).toBe(NEW_PIN_LENGTH);
    await setLockPin('123456', 'u1');
    expect(lockPinLength('u1')).toBe(6);

    // A PIN stored before 6-digit support has no `len`.
    await setLockPin('1234', 'u1');
    const stored = JSON.parse(localStorage.getItem('tamamhealth-pin-hash.u1')!);
    delete stored.len;
    localStorage.setItem('tamamhealth-pin-hash.u1', JSON.stringify(stored));
    expect(lockPinLength('u1')).toBe(4);
    const latest = mount();
    expect(latest().pinLength).toBe(4);
    await act(async () => { await expect(latest().verifyPin('1234')).resolves.toBe(true); });
  });
});

describe('inert behind the overlay', () => {
  it('marks everything outside the overlay inert and aria-hidden, and undoes it', () => {
    document.body.innerHTML = `
      <div id="app"><main id="main"><button id="b">x</button></main><div id="lock"></div></div>
      <div id="portal"></div>`;
    const undo = inertOutside(document.getElementById('lock')!);
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('main')!.getAttribute('aria-hidden')).toBe('true');
    expect(document.getElementById('portal')!.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('lock')!.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
    undo();
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('portal')!.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('tab switching', () => {
  afterEach(() => { setHidden(false); sessionStorage.clear(); });

  it('hiding a tab locks that tab only: nothing shared is written, so the other tab stays unlocked', () => {
    const latest = mount();
    act(() => { setHidden(true); });
    expect(latest().isLocked).toBe(true);
    expect(readLockState('u1').locked).toBe(false);

    // Tab B: shares localStorage but has its own sessionStorage.
    sessionStorage.clear();
    const containerB = document.createElement('div');
    document.body.appendChild(containerB);
    const rootB = createRoot(containerB);
    let b!: ReturnType<typeof useAutoLock>;
    function HarnessB() { b = useAutoLock(true, undefined, 10, undefined, 'u1'); return null; }
    act(() => { rootB.render(<HarnessB />); });
    expect(b.isLocked).toBe(false);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: lockStateKey('u1'), newValue: '{}' })); });
    expect(b.isLocked).toBe(false);
    act(() => rootB.unmount());
    containerB.remove();
  });

  it('another tab routine activity write does not unlock the tab that was left', () => {
    const latest = mount();
    act(() => { setHidden(true); });
    writeLockState('u1', { at: Date.now() });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: lockStateKey('u1'),
        oldValue: JSON.stringify({ locked: false, at: 1, fails: 0 }),
        newValue: JSON.stringify({ locked: false, at: 2, fails: 0 }),
      }));
    });
    expect(latest().isLocked).toBe(true);
  });

  it('a reload of the tab that was left comes back locked; unlock clears it', () => {
    let latest = mount();
    act(() => { setHidden(true); });
    act(() => root.unmount());
    root = createRoot(container);
    setHidden(false);
    latest = mount();
    expect(latest().isLocked).toBe(true);
    act(() => { latest().unlock(); });
    expect(sessionStorage.length).toBe(0);
  });

  it('explicit lock still locks every tab', () => {
    const latest = mount();
    act(() => { latest().lock(); });
    expect(readLockState('u1').locked).toBe(true);
  });
});

describe('late-loading policy', () => {
  beforeEach(() => { setRoleSettings({ 'security.lock': true, 'security.idle': 'Off' }); });
  it('a stored lock survives a first render where the policy has not loaded yet', () => {
    writeLockState('u1', { locked: true, at: Date.now() });
    const latest = mount(null);
    expect(latest().lockEnabled).toBe(false);
    expect(readLockState('u1').locked).toBe(true);
    latest.rerender(10);
    expect(latest().lockEnabled).toBe(true);
    expect(latest().isLocked).toBe(true);
  });

  it('an idle window already passed is honoured once the policy arrives', () => {
    writeLockState('u1', { locked: false, at: Date.now() - 11 * 60_000 });
    const latest = mount(null);
    expect(latest().isLocked).toBe(false);
    latest.rerender(10);
    expect(latest().isLocked).toBe(true);
  });

  it('does not overwrite the stored activity time while the policy is unknown', () => {
    const at = Date.now() - 5 * 60_000;
    writeLockState('u1', { locked: false, at });
    mount(null);
    expect(readLockState('u1').at).toBe(at);
  });
});

describe('new PIN length', () => {
  it('accepts exactly six digits', () => {
    expect(isValidNewPin('123456')).toBe(true);
    expect(isValidNewPin('1234')).toBe(false);
    expect(isValidNewPin('12345')).toBe(false);
    expect(isValidNewPin('1234567')).toBe(false);
    expect(isValidNewPin('12345a')).toBe(false);
  });
});

describe('inertOutside restores prior attributes', () => {
  it('keeps inert/aria-hidden the page already had', () => {
    document.body.innerHTML = `
      <div id="app"><main id="pre" inert aria-hidden="true"></main><main id="plain"></main><div id="lock"></div></div>`;
    const undo = inertOutside(document.getElementById('lock')!);
    undo();
    const pre = document.getElementById('pre')!;
    expect(pre.hasAttribute('inert')).toBe(true);
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(pre.hasAttribute('data-lock-inert')).toBe(false);
    const plain = document.getElementById('plain')!;
    expect(plain.hasAttribute('inert')).toBe(false);
    expect(plain.hasAttribute('aria-hidden')).toBe(false);
  });
});
