/**
 * BootIntegrityGuard — the "reload once" cap on asset-failure recovery.
 *
 * The bug this pins: the guard stored a bare '1' in sessionStorage to record
 * that it had already spent its one recovery reload, and then CLEARED that flag
 * on every mount, reasoning that "a clean mount means the bundle loaded fine".
 * It does not. The failures the guard exists for — a lazily-loaded chunk, a
 * stylesheet that 404s after a rebuild or a stale service-worker cache — arrive
 * AFTER the guard has mounted and already wiped the flag. So every reload
 * started with a clean slate and the cap never held: one bad chunk reloaded the
 * page about five times a second, indefinitely, which made the app unusable
 * (observed: 57 navigations in 12 seconds, and an org admin unable to finish
 * creating a staff account).
 *
 * The reload decision is tested through the pure `recoveryAction` rule, because
 * jsdom's `location.reload` is unforgeable and a mounted component cannot
 * observe it. The DOM test below covers the other half: which failures are
 * treated as boot-critical at all.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import BootIntegrityGuard, { recoveryAction } from '@/components/BootIntegrityGuard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_760_000_000_000;

describe('recovery decision', () => {
  it('reloads the first time an asset fails', () => {
    expect(recoveryAction({ storedFlag: null, now: NOW, isDev: false })).toBe('reload');
  });

  it('does NOT reload again right after a recovery reload', () => {
    // The regression: the post-reload page mounts, fails again, and must stop.
    // Under the old flag-cleared-on-mount logic this returned 'reload' forever.
    const justReloaded = String(NOW - 200);
    expect(recoveryAction({ storedFlag: justReloaded, now: NOW, isDev: false })).toBe('show-error');
  });

  it('stays stopped across a burst of failures', () => {
    const justReloaded = String(NOW - 50);
    for (let i = 0; i < 10; i++) {
      expect(recoveryAction({ storedFlag: justReloaded, now: NOW + i, isDev: false })).toBe('show-error');
    }
  });

  it('allows a fresh recovery once the cooldown has passed', () => {
    // A failure ten minutes into a session is a new problem, not the same one
    // looping — it still earns its one reload.
    const longAgo = String(NOW - 10 * 60 * 1000);
    expect(recoveryAction({ storedFlag: longAgo, now: NOW, isDev: false })).toBe('reload');
  });

  it('treats an unreadable or garbage flag as "never recovered"', () => {
    // Blocked storage and the old boolean '1' value both land here; neither may
    // suppress the one recovery a genuine failure is owed.
    expect(recoveryAction({ storedFlag: '', now: NOW, isDev: false })).toBe('reload');
    expect(recoveryAction({ storedFlag: 'yes', now: NOW, isDev: false })).toBe('reload');
    expect(recoveryAction({ storedFlag: '1', now: NOW, isDev: false })).toBe('reload');
  });

  it('never auto-reloads in development', () => {
    // A dev rebuild invalidates chunk URLs as a matter of course; Fast Refresh
    // is the recovery there, and reloading only produces the storm.
    expect(recoveryAction({ storedFlag: null, now: NOW, isDev: true })).toBe('show-error');
  });
});

describe('which failures count as boot-critical', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<BootIntegrityGuard />); });
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  /** Dispatch a load failure on a real element. Resource errors do not bubble,
   *  so the guard listens in the capture phase and the event is fired on the
   *  element itself. */
  function failAsset(el: Element) {
    document.body.appendChild(el);
    act(() => { el.dispatchEvent(new Event('error')); });
    el.remove();
  }

  const errorScreen = () => container.querySelector('[role="alert"]');

  it("reacts to the app's own script", () => {
    // NODE_ENV is 'test' under Jest, so recoveryAction returns 'show-error' —
    // which is exactly what makes the reaction observable here.
    const script = document.createElement('script');
    script.src = 'http://localhost/_next/static/chunks/main-abc123.js';
    failAsset(script);
    expect(errorScreen()).not.toBeNull();
  });

  it("reacts to the app's own stylesheet", () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'http://localhost/_next/static/css/app.css';
    failAsset(link);
    expect(errorScreen()).not.toBeNull();
  });

  it('ignores third-party scripts and browser extensions', () => {
    const thirdParty = document.createElement('script');
    thirdParty.src = 'https://cdn.example.com/widget.js';
    failAsset(thirdParty);
    expect(errorScreen()).toBeNull();
  });

  it('ignores a non-stylesheet link', () => {
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = 'http://localhost/_next/static/css/app.css';
    failAsset(preconnect);
    expect(errorScreen()).toBeNull();
  });
});
