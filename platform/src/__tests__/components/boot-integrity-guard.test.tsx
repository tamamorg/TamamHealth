/**
 * BootIntegrityGuard — the "reload once" cap on asset-failure recovery.
 *
 * Two bugs are pinned here.
 *
 * 1. The cap that never held. The guard stored a bare '1' in sessionStorage to
 *    record that it had spent its one recovery reload, then CLEARED that flag
 *    on every mount, reasoning that "a clean mount means the bundle loaded
 *    fine". It does not: the failures it watches for arrive AFTER the guard has
 *    mounted and already wiped the flag. Every reload started with a clean
 *    slate, so one bad asset reloaded the page about five times a second,
 *    indefinitely (observed: 57 navigations in 12 seconds, and an org admin
 *    unable to finish creating a staff account).
 *
 * 2. The scope that was too wide. It also reacted to failed SCRIPTS, so a
 *    lazily-imported feature chunk — one dashboard's data services — replaced
 *    a working session with a full-screen "Couldn't load the app". Stylesheets
 *    only now; see the SCOPE note in the component.
 *
 * The reload decision is tested through the pure `recoveryAction` rule, because
 * jsdom's `location.reload` is unforgeable and a mounted component cannot
 * observe it. The DOM tests below cover the other half: which failures the
 * guard treats as its business at all.
 */
import { act } from 'react';
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

  // Captured before any test mocks Date.now, so the "long after boot" cases can
  // still express a real wall-clock offset from mount.
  const realNow = Date.now.bind(Date);

  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<BootIntegrityGuard />); });
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("reacts to the app's own stylesheet", () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'http://localhost/_next/static/css/app.css';
    failAsset(link);
    expect(errorScreen()).not.toBeNull();
  });

  it('ignores third-party stylesheets and browser extensions', () => {
    const thirdParty = document.createElement('link');
    thirdParty.rel = 'stylesheet';
    thirdParty.href = 'https://cdn.example.com/widget.css';
    failAsset(thirdParty);
    expect(errorScreen()).toBeNull();
  });

  it("ignores the app's own scripts entirely", () => {
    // A failed script is a lazily-imported feature chunk, and its caller
    // handles it. Reacting here blanked a working app over one optional chunk
    // — see the SCOPE note in BootIntegrityGuard.
    const script = document.createElement('script');
    script.src = 'http://localhost/_next/static/chunks/src_lib_services_1-bu.js';
    failAsset(script);
    expect(errorScreen()).toBeNull();
  });

  it('ignores a non-stylesheet link', () => {
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = 'http://localhost/_next/static/css/app.css';
    failAsset(preconnect);
    expect(errorScreen()).toBeNull();
  });

  it('still reacts to a stylesheet that fails long after boot', () => {
    // Whenever it happens, a missing stylesheet is the raw-unstyled-HTML
    // symptom this guard exists for.
    jest.spyOn(Date, 'now').mockReturnValue(realNow() + 60_000);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'http://localhost/_next/static/css/app.css';
    failAsset(link);
    expect(errorScreen()).not.toBeNull();
  });
});
