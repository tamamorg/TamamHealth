import Link from 'next/link';
import type { ReactNode } from 'react';
import PrintDocumentButton from '@/components/PrintDocumentButton';

/* ═══════════════════════════════════════════════════════════════════
   PublicLegalShell — shared chrome for the public legal documents
   (/privacy, /terms).

   These pages are DOCUMENTS, not app screens. They used to be dressed as
   one: the logo linked into the product, the header carried a "Staff Sign In"
   button and the footer called /login "Home", so a reader who opened the
   Terms to read them landed on something that looked like a step in signing
   in. Nothing here needs an account, and nothing here is part of a sign-in
   flow — a patient, a regulator or a facility deciding whether to adopt the
   platform must be able to read the whole text having never had a login.

   So the chrome is a document's chrome: an unlinked wordmark, the document's
   identity (version, effective date) where the sign-in button used to be, a
   print action, and an optional contents list. The only links are to the
   other legal document and to a contact address.

   Applies the platform design system (globals.css tokens): cream app canvas,
   white 14px-radius card with slate-100 border and the standard card shadow,
   DM Sans type scale, brand-blue links, dark footer matching the landing page.
   Server component apart from the print button.
   ═══════════════════════════════════════════════════════════════════ */

export interface LegalTocEntry {
  /** Matches the `id` on the section's <h2>. */
  id: string;
  label: string;
}

export default function PublicLegalShell({
  title,
  subtitle,
  children,
  version,
  effectiveDate,
  toc,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** e.g. "2.0" — printed in the header and above the text. */
  version?: string;
  /** Human-readable, e.g. "12 August 2026". */
  effectiveDate?: string;
  /** Section links. Omitted for documents short enough to read straight through. */
  toc?: LegalTocEntry[];
}) {
  const hasStamp = Boolean(version || effectiveDate);
  return (
    <div className="lg-shell">
      {/* ── Header ── */}
      <header className="lg-header">
        <div className="lg-container lg-header__inner">
          {/* Not a link. Clicking the wordmark used to open /login, which is
              exactly the tie this page should not have. */}
          <span className="lg-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logos/SVG/Tamam_Style_Guide-21.svg" alt="TamamHealth" style={{ height: 26, width: 'auto' }} />
          </span>
          <div className="lg-header__nav">
            {hasStamp && (
              <span className="lg-header__stamp">
                {[version && `Version ${version}`, effectiveDate && `Effective ${effectiveDate}`]
                  .filter(Boolean).join(' · ')}
              </span>
            )}
            <PrintDocumentButton />
          </div>
        </div>
      </header>

      {/* ── The document ── */}
      <main className="lg-main">
        <div className="lg-container">
          <article className="lg-card">
            <span className="lg-eyebrow">TamamHealth — Digital Health Records Platform</span>
            <h1 className="lg-title">{title}</h1>
            <p className="lg-subtitle">{subtitle}</p>

            {hasStamp && (
              <dl className="lg-meta">
                {version && (<><dt>Version</dt><dd>{version}</dd></>)}
                {effectiveDate && (<><dt>Effective</dt><dd>{effectiveDate}</dd></>)}
              </dl>
            )}

            {toc && toc.length > 0 && (
              <nav className="lg-toc" aria-label="Contents">
                <h2 className="lg-toc__title">Contents</h2>
                <ol>
                  {toc.map((entry, i) => (
                    <li key={entry.id}>
                      <a href={`#${entry.id}`}>
                        <span className="lg-toc__num">{i + 1}.</span> {entry.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            <div className="lg-body">{children}</div>
          </article>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="lg-footer">
        <div className="lg-container lg-footer__inner">
          <p>© {new Date().getFullYear()} TamamHealth. All rights reserved.</p>
          <nav className="lg-footer__nav">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms &amp; Conditions</Link>
            <a href="mailto:support.tamam@gmail.com">Contact</a>
          </nav>
        </div>
      </footer>

      <style
        dangerouslySetInnerHTML={{
          __html: `
.lg-shell {
  min-height: 100vh;
  display: flex; flex-direction: column;
  background: var(--bg-app, #FFFFFF);
  font-family: var(--font-platform, var(--font-dm-sans), 'DM Sans', system-ui, sans-serif);
  color: var(--text-primary, #113055);
}
.lg-container { max-width: 860px; margin: 0 auto; padding: 0 24px; width: 100%; }

/* Header */
.lg-header {
  background: var(--bg-card-solid, #FFFFFF);
  border-bottom: 1px solid var(--border-light, #ECEEF1);
  padding: 14px 0;
}
.lg-header__inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.lg-logo { display: inline-flex; align-items: center; }
.lg-header__nav { display: flex; align-items: center; gap: 14px; }
.lg-header__stamp {
  font-size: 12px; font-weight: 600; color: var(--text-muted, #5D728B);
  letter-spacing: -0.01em; white-space: nowrap;
}
.lg-print-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; border-radius: var(--btn-radius, 10px);
  font-size: 0.8rem; font-weight: 600; letter-spacing: -0.01em;
  font-family: inherit; cursor: pointer;
  color: var(--text-secondary, #3C5574);
  background: var(--bg-card-solid, #FFFFFF);
  border: 1px solid var(--border-medium, #D9DEE4);
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.lg-print-btn:hover {
  background: var(--overlay-subtle, rgba(33,145,208,0.07));
  border-color: var(--color-brand-500, #2191D0);
  color: var(--text-primary, #113055);
}
@media (max-width: 560px) {
  .lg-header__stamp { display: none; }
}
.lg-header__link {
  font-size: 14px; font-weight: 500; color: var(--text-secondary, #3C5574);
  text-decoration: none; padding: 6px 10px; border-radius: 8px;
  transition: color 0.18s ease, background-color 0.18s ease;
}
.lg-header__link:hover { color: var(--accent-hover, #001D3F); background: var(--overlay-subtle, rgba(33,145,208,0.07)); }
.lg-btn-secondary {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 18px; border-radius: var(--btn-radius, 10px);
  font-size: 0.82rem; font-weight: 600; letter-spacing: -0.01em;
  color: var(--text-secondary, #3C5574); text-decoration: none;
  background: var(--bg-card-solid, #FFFFFF);
  border: 1px solid var(--border-medium, #D9DEE4);
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.lg-btn-secondary:hover {
  background: var(--overlay-subtle, rgba(33,145,208,0.07));
  border-color: var(--color-brand-500, #2191D0);
  color: var(--text-primary, #113055);
}

/* Content card */
.lg-main { flex: 1; padding: 48px 0 72px; }
.lg-card {
  background: var(--bg-card-solid, #FFFFFF);
  border: 1px solid var(--border-light, #ECEEF1);
  border-radius: var(--card-radius, 14px);
  box-shadow: var(--card-shadow, 0 1px 2px rgba(17, 48, 85, 0.05));
  padding: clamp(28px, 5vw, 56px);
}
.lg-eyebrow {
  display: inline-block;
  font-size: 11px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--accent-text, #015697);
  background: var(--color-info-bg, rgba(33,145,208,0.12));
  padding: 5px 12px; border-radius: 100px; margin-bottom: 18px;
}
.lg-title {
  font-size: 1.875rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15;
  color: var(--text-primary, #113055); margin: 0;
}
.lg-subtitle { font-size: 13.5px; color: var(--text-muted, #5D728B); margin: 8px 0 0; }

/* Version / effective date — the stamp that makes this a document you can
   cite rather than a page that quietly changes under the reader. */
.lg-meta {
  display: flex; flex-wrap: wrap; gap: 8px 28px;
  margin: 18px 0 0; padding: 14px 0 0;
  border-top: 1px solid var(--border-light, #ECEEF1);
  font-size: 12.5px;
}
.lg-meta dt {
  font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  font-size: 10.5px; color: var(--text-muted, #5D728B);
  align-self: center; margin-right: -20px;
}
.lg-meta dd { margin: 0; color: var(--text-secondary, #3C5574); font-weight: 600; align-self: center; }

/* Contents */
.lg-toc {
  margin-top: 24px; padding: 18px 22px;
  background: var(--overlay-subtle, rgba(33,145,208,0.07));
  border: 1px solid var(--border-light, #ECEEF1);
  border-radius: var(--btn-radius, 10px);
}
.lg-toc__title {
  margin: 0 0 10px; font-size: 11px; font-weight: 800;
  letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--text-muted, #5D728B);
}
.lg-toc ol {
  margin: 0; padding: 0; list-style: none;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 6px 24px;
}
.lg-toc a {
  display: flex; gap: 7px; font-size: 13.5px; line-height: 1.5;
  color: var(--text-secondary, #3C5574); text-decoration: none;
}
.lg-toc a:hover { color: var(--link-color, #015697); text-decoration: underline; }
.lg-toc__num { color: var(--text-muted, #5D728B); font-variant-numeric: tabular-nums; }

.lg-body { margin-top: 28px; font-size: 15px; line-height: 1.7; color: var(--text-secondary, #3C5574); }
.lg-body ul { margin: 0 0 12px; padding-left: 22px; }
.lg-body li { margin: 0 0 6px; }
.lg-body strong { color: var(--text-primary, #113055); font-weight: 700; }
/* Anchored sections land clear of the top of the window. */
.lg-body h2[id] { scroll-margin-top: 24px; }
.lg-body h2 {
  font-size: 1.1875rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25;
  color: var(--text-primary, #113055);
  margin: 28px 0 8px; padding-top: 20px;
  border-top: 1px solid var(--border-light, #ECEEF1);
}
.lg-body h2:first-of-type { border-top: none; padding-top: 0; margin-top: 24px; }
.lg-body p { margin: 0 0 12px; }
.lg-body a { color: var(--link-color, #015697); font-weight: 600; text-decoration: none; }
.lg-body a:hover { text-decoration: underline; }
.lg-note {
  margin-top: 28px; padding: 14px 18px;
  font-size: 12.5px; line-height: 1.6; color: var(--text-muted, #5D728B);
  background: var(--overlay-subtle, rgba(33,145,208,0.07));
  border: 1px solid var(--border-light, #ECEEF1);
  border-radius: var(--btn-radius, 10px);
}

/* Footer */
.lg-footer {
  background: #001d3f; color: rgba(255,255,255,0.6);
  padding: 22px 0; font-size: 13px;
}
.lg-footer__inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.lg-footer__nav { display: flex; gap: 18px; }
.lg-footer__nav a { color: rgba(255,255,255,0.8); text-decoration: none; }
.lg-footer__nav a:hover { color: #fff; }
@media (max-width: 560px) {
  .lg-footer__inner { flex-direction: column; text-align: center; }
}

/* Printed / saved as PDF. The global print stylesheet already drops the
   header nav and every button; this takes off the screen furniture that is
   left — the card's frame and the app canvas — so the paper carries the
   text, the version stamp and the footer's contact line, and nothing else. */
@media print {
  .lg-shell { background: #fff; }
  .lg-header { border-bottom: 1px solid #ccc; padding: 0 0 10px; }
  .lg-main { padding: 18px 0 0; }
  .lg-container { max-width: none; padding: 0; }
  .lg-card { border: none; box-shadow: none; padding: 0; }
  .lg-eyebrow { background: none; padding: 0; color: #444; }
  /* The global print stylesheet hides every <nav>, which would take the
     contents list with it. A printed legal document keeps its contents —
     it is how a reader finds section 15 in a stapled copy. */
  .lg-toc { display: block !important; break-inside: avoid; background: none; border: 1px solid #ccc; }
  .lg-body h2 { break-after: avoid; }
  .lg-body p, .lg-body li { orphans: 3; widows: 3; }
  .lg-footer { background: none; color: #444; border-top: 1px solid #ccc; }
  .lg-footer__nav { display: none; }
}
`,
        }}
      />
    </div>
  );
}
