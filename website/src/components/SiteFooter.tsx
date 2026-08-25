/* ═══ Site chrome: footer ═══
   Server component — the ≤520px accordions are native <details>, no JS.

   The columns render CLOSED, and CSS forces their content visible above
   520px (see .tm-foot-col::details-content in globals.css). That inversion is
   what makes one markup serve both: a phone gets collapsed accordions it can
   tap open, a desktop gets plain lists. Adding `open` here instead would
   expand them everywhere — including the phones the accordion exists for —
   because the initial state of <details> cannot be set per breakpoint. */

import Link from "next/link";
import Image from "next/image";
import { FOOTER_COLS as FOOTER_COLS_EN, platformHref } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";
// The columns carry section links (/platform#how-it-works, /health-system#levels);
// HashLink is next/link plus the same-page case the router treats as a no-op.
import HashLink from "@/components/HashLink";

export default async function SiteFooter() {
  const { t, content } = await getTranslator();
  const FOOTER_COLS = content(FOOTER_COLS_EN);

  return (
    <footer style={{ background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)", padding: "60px 32px 30px" }}>
      <div className="tm-footer-grid" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr", gap: 44 }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: "var(--color-neutral-700)" }}>
          {t("TamamHealth is offline-first digital health infrastructure for South Sudan and sub-Saharan Africa — one patient record that works through power cuts and network gaps, from the Boma health worker to the Ministry of Health. Founded at Tufts University · starting in South Sudan, built for sub-Saharan Africa.")}
        </p>
        {FOOTER_COLS.map((col) => (
          <details key={col.title} className="tm-foot-col">
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
                  <HashLink key={l.label} href={l.href} style={{ fontSize: 13.5, color: "var(--color-neutral-800)", textDecoration: "none" }}>
                    {l.label}
                  </HashLink>
                ),
              )}
            </div>
          </details>
        ))}
      </div>
      <div className="tm-footer-legal" style={{ maxWidth: 1320, margin: "40px auto 0", paddingTop: 22, borderTop: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Image src="/assets/tamam-logo-mark.svg" alt="" width={64} height={64} style={{ height: 26, width: "auto" }} />
          <span className="fs125" style={{ color: "var(--color-neutral-700)" }}>{t("© 2026 TamamHealth")}</span>
        </div>
        <div className="fs125" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <Link href="/terms" style={{ color: "var(--color-neutral-700)", textDecoration: "none" }}>{t("Terms & Conditions")}</Link>
          {/* Privacy lives as a clause inside the terms, so it deep-links to
              that clause rather than dropping the reader at the page top. */}
          <HashLink href="/terms#patient-data" style={{ color: "var(--color-neutral-700)", textDecoration: "none" }}>{t("Privacy Policy")}</HashLink>
          <a href={platformHref("staff")} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-neutral-700)", textDecoration: "none" }}>{t("Platform login")}</a>
        </div>
      </div>
    </footer>
  );
}
