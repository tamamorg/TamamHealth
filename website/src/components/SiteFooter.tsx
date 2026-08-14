/* ═══ Site chrome: footer ═══
   Server component — the ≤520px accordions are native <details>, no JS. */

import Link from "next/link";
import { FOOTER_COLS } from "@/lib/site-data";

export default function SiteFooter() {
  return (
    <footer style={{ background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)", padding: "60px 32px 30px" }}>
      <div className="tm-footer-grid" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr", gap: 44 }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: "var(--color-neutral-700)" }}>
          TamamHealth is offline-first digital health infrastructure for South Sudan and sub-Saharan Africa — one patient record
          that works through power cuts and network gaps, from the Boma health worker to the Ministry of Health. Founded at Tufts
          University · starting in South Sudan, built for sub-Saharan Africa.
        </p>
        {FOOTER_COLS.map((col) => (
          <details key={col.title} className="tm-foot-col" open>
            <summary className="tm-foot-sum">
              <h4 style={{ fontSize: 18, margin: 0, color: col.accent }}>{col.title}</h4>
              <svg className="tm-foot-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-neutral-700)" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
            </summary>
            <div className="tm-foot-links">
              {col.links.map((l) =>
                l.external ? (
                  <a key={l.label} href={l.href} style={{ fontSize: 13.5, color: "var(--color-neutral-800)", textDecoration: "none" }}>
                    {l.label}
                  </a>
                ) : (
                  <Link key={l.label} href={l.href} style={{ fontSize: 13.5, color: "var(--color-neutral-800)", textDecoration: "none" }}>
                    {l.label}
                  </Link>
                ),
              )}
            </div>
          </details>
        ))}
      </div>
      <div className="tm-footer-legal" style={{ maxWidth: 1320, margin: "40px auto 0", paddingTop: 22, borderTop: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- small inline SVG mark */}
          <img src="/assets/tamam-logo-mark.svg" alt="" style={{ height: 26, width: "auto" }} />
          <span className="fs125" style={{ color: "var(--color-neutral-700)" }}>© 2026 TamamHealth</span>
        </div>
        <div className="fs125" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <Link href="/terms" style={{ color: "var(--color-neutral-700)", textDecoration: "none" }}>Terms &amp; Conditions</Link>
          <Link href="/terms" style={{ color: "var(--color-neutral-700)", textDecoration: "none" }}>Privacy Policy</Link>
          <Link href="/login" style={{ color: "var(--color-neutral-700)", textDecoration: "none" }}>Platform login</Link>
        </div>
      </div>
    </footer>
  );
}
