'use client';

// Last-resort crash screen: rendered by Next.js when the ROOT layout itself
// throws, which means none of the app's providers, CSS, or i18n are available.
// Everything here MUST therefore be self-contained — inline literal styles only,
// no context hooks, no CSS variables (globals.css isn't loaded at this level),
// no translation chunks (they may be the very thing that failed to load).
// If this screen depended on any of those, a hard crash would fall through to
// raw, unstyled browser HTML instead of a usable error page.

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const colors = {
    bg: '#001D3F',
    text: '#F1F3F5',
    muted: '#94A2B3',
    dangerBg: 'rgba(224, 49, 39,0.12)',
    dangerBorder: 'rgba(224, 49, 39,0.25)',
    primary: '#2191D0',
    white: '#FFFFFF',
    secondaryBorder: 'rgba(255,255,255,0.18)',
    secondaryText: '#CFD6DD',
  };

  return (
    <html lang="en">
      <body style={{ margin: 0, background: colors.bg, color: colors.text, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: '420px', width: '100%', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.dangerBg, border: `1px solid ${colors.dangerBorder}` }}>
              <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>⚠️</span>
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px' }}>Something went wrong</h2>
            <p style={{ fontSize: '14px', color: colors.muted, margin: '0 0 24px', lineHeight: 1.5 }}>
              The app ran into an unexpected problem. Reloading usually fixes it. If it keeps happening, contact your administrator.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => { try { reset(); } catch { window.location.reload(); } }}
                style={{ background: colors.primary, color: colors.white, border: 'none', padding: '12px 24px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{ background: 'transparent', color: colors.secondaryText, border: `1px solid ${colors.secondaryBorder}`, padding: '12px 24px', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
