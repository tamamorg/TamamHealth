'use client';

// Guards against the "raw unstyled HTML" failure mode — when one of the app's
// stylesheets fails to load (stale PWA/service-worker cache after a deploy, a
// 404 on a hashed asset, or a flaky network), the page renders with no CSS
// instead of the app. React error boundaries can't catch this because nothing
// *throws*, so we listen for resource-load failures directly.
//
// Recovery: reload once (a fresh fetch usually resolves a stale-cache/chunk
// mismatch). If the failure survives the reload, we stop retrying and render a
// fully self-contained, inline-styled error screen — never the unstyled page.

import { useEffect, useState } from 'react';

// Timestamp (ms) of the last recovery reload, kept in sessionStorage so it
// survives that reload — the whole point of the cap.
const RELOAD_FLAG = 'ths-boot-reloaded';

// How long a recovery reload suppresses the next one.
//
// This used to be a bare '1' that the effect below CLEARED on every mount, on
// the theory that "a clean mount means the bundle loaded fine". It doesn't: a
// stylesheet that 404s after a rebuild lands AFTER the guard has mounted and
// already wiped the flag. So every reload started with a clean slate, the "at
// most once" cap never held, and one bad asset turned into a page reloading
// roughly five times a second until the tab was closed. A timestamp fixes
// that: it ages out on its own, so a genuinely *later* failure still earns its
// one recovery, while a failure that repeats immediately gets the error screen
// instead of a loop.
const RECOVERY_COOLDOWN_MS = 60_000;

// SCOPE: stylesheets only, deliberately.
//
// This guard exists for one symptom — the page renders as raw unstyled HTML
// instead of the app — and that symptom is a missing stylesheet. It used to
// react to failed SCRIPTS too, which turned out to be both useless and
// harmful.
//
// Useless, because a JS bundle that never arrives means React never runs, so
// this component never mounts and never gets to listen. By the time its
// listeners are attached the app is demonstrably up.
//
// Harmful, because what a running app actually fails to fetch is
// lazily-imported feature chunks — one dashboard's data services, a modal, a
// chart — and every one of those callers already handles its own failure. The
// facility dashboard, for instance, names the datasets it could not load and
// offers Retry. Replacing that with a full-screen "Couldn't load the app", or
// a reload, threw away a working session over one optional chunk. A timing
// window doesn't separate the two either: those chunks are requested within a
// second or two of mount, indistinguishable from boot.
//
// So: a stylesheet that fails, whenever it happens, is this guard's business.
// A script that fails belongs to whoever imported it.

// Only treat the app's OWN stylesheets/scripts as boot-critical. Third-party or
// browser-extension scripts can fail without breaking the app, and reacting to
// those would cause spurious reloads.
function isOwnAsset(url: string): boolean {
  if (!url) return false;
  if (url.includes('/_next/')) return true;
  try { return new URL(url, window.location.href).origin === window.location.origin; } catch { return false; }
}

function isStylesheetFailure(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLLinkElement)) return false;
  return (target.rel || '').includes('stylesheet') && isOwnAsset(target.href);
}

/**
 * What to do about an asset failure: reload to fetch fresh copies, or stop and
 * show the error screen.
 *
 * Pure and exported so the "never loop" invariant can be tested directly —
 * jsdom's `location.reload` is unforgeable, so a DOM test cannot observe the
 * reload itself, and this rule is the whole of the fix.
 */
export function recoveryAction(input: {
  /** Raw sessionStorage value, or null when unset/unreadable. */
  storedFlag: string | null;
  now: number;
  isDev: boolean;
}): 'reload' | 'show-error' {
  // A dev server invalidates chunk URLs on every edit, so a page open across a
  // rebuild routinely hits exactly this failure. Reloading there fights Fast
  // Refresh (already recovering) and hides the real error behind a storm.
  if (input.isDev) return 'show-error';
  const lastRecovery = Number(input.storedFlag) || 0;
  return input.now - lastRecovery < RECOVERY_COOLDOWN_MS ? 'show-error' : 'reload';
}

export default function BootIntegrityGuard() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const recover = () => {
      // Reload at most once per cooldown window to fetch fresh assets; if the
      // page is already a post-recovery reload, surface the error screen
      // instead of looping forever.
      let storedFlag: string | null = null;
      try { storedFlag = sessionStorage.getItem(RELOAD_FLAG); } catch { /* storage blocked */ }
      const now = Date.now();
      if (recoveryAction({ storedFlag, now, isDev: process.env.NODE_ENV !== 'production' }) === 'show-error') {
        setFailed(true);
        return;
      }
      try { sessionStorage.setItem(RELOAD_FLAG, String(now)); } catch { /* ignore */ }
      window.location.reload();
    };

    // Resource load failures bubble to window only in the capture phase.
    const onResourceError = (e: Event) => {
      if (isStylesheetFailure(e.target)) recover();
    };

    window.addEventListener('error', onResourceError, true);

    // NB: the flag is deliberately NOT cleared here. It expires on its own
    // after RECOVERY_COOLDOWN_MS, which is what lets a later failure still get
    // a recovery reload without letting an immediate repeat become a loop.

    return () => {
      window.removeEventListener('error', onResourceError, true);
    };
  }, []);

  if (!failed) return null;

  // Self-contained, inline-styled (the app's CSS is exactly what failed here).
  return (
    <div
      role="alert"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483647,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box',
        background: '#0f1117', color: '#f1f5f9',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(229,46,66,0.12)', border: '1px solid rgba(229,46,66,0.25)' }}>
          <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>⚠️</span>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Couldn’t load the app</h2>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 24px', lineHeight: 1.5 }}>
          Some files didn’t load correctly — this is usually a network hiccup or an out-of-date copy of the app. Reloading should fix it.
        </p>
        <button
          onClick={() => { try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ } window.location.reload(); }}
          style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
