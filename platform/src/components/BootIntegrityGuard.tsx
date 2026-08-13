'use client';

// Guards against the "raw unstyled HTML" failure mode — when a stylesheet or JS
// chunk fails to load (stale PWA/service-worker cache after a deploy, a 404 on a
// hashed asset, or a flaky network), the page renders with no CSS instead of
// the app. React error boundaries can't catch this because nothing *throws*, so
// we listen for resource-load failures directly.
//
// Recovery: reload once (a fresh fetch usually resolves a stale-cache/chunk
// mismatch). If the failure survives the reload, we stop retrying and render a
// fully self-contained, inline-styled error screen — never the unstyled page.

import { useEffect, useState } from 'react';

const RELOAD_FLAG = 'ths-boot-reloaded';

// Only treat the app's OWN stylesheets/scripts as boot-critical. Third-party or
// browser-extension scripts can fail without breaking the app, and reacting to
// those would cause spurious reloads.
function isOwnAsset(url: string): boolean {
  if (!url) return false;
  if (url.includes('/_next/')) return true;
  try { return new URL(url, window.location.href).origin === window.location.origin; } catch { return false; }
}

function isAssetFailure(target: EventTarget | null): boolean {
  if (target instanceof HTMLLinkElement) return (target.rel || '').includes('stylesheet') && isOwnAsset(target.href);
  if (target instanceof HTMLScriptElement) return isOwnAsset(target.src);
  return false;
}

function isChunkError(reason: unknown): boolean {
  const msg = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? '');
  return /ChunkLoadError|Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
}

export default function BootIntegrityGuard() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const recover = () => {
      // Reload at most once per tab session to fetch fresh assets; if the page
      // is already a post-recovery reload, surface the error screen instead of
      // looping forever.
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch { /* storage blocked */ }
      if (alreadyReloaded) { setFailed(true); return; }
      try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* ignore */ }
      window.location.reload();
    };

    // Resource (CSS/JS) load failures bubble to window only in the capture phase.
    const onResourceError = (e: Event) => {
      if (isAssetFailure(e.target)) recover();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkError(e.reason)) recover();
    };

    window.addEventListener('error', onResourceError, true);
    window.addEventListener('unhandledrejection', onRejection);

    // A clean mount means the bundle loaded fine — clear the one-shot flag so a
    // *future* failure is still allowed its single recovery reload.
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }

    return () => {
      window.removeEventListener('error', onResourceError, true);
      window.removeEventListener('unhandledrejection', onRejection);
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
