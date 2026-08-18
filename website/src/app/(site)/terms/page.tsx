import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL as LEGAL_EN, platformHref } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "The terms that govern use of the TamamHealth platform and this website.",
};

export default async function TermsPage() {
  const { t, content } = await getTranslator();
  const LEGAL = content(LEGAL_EN);
  return (
    <main>
      <section style={{ padding: "60px 32px 30px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(31px, 5.2vw, 56px)", margin: "0 0 8px" }}>{t("Terms & Conditions")}</h1>
          <p style={{ margin: 0, fontSize: 17, color: "var(--color-neutral-700)" }}>{t("The terms that govern use of the TamamHealth platform and this website.")}</p>
          <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--color-neutral-600)" }}>{t("Last updated 13 August 2026 · Draft for review — not yet legal advice.")}</p>
        </div>
      </section>
      <section style={{ padding: "20px 32px 96px" }}>
        <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "300px 1fr", gap: 64, alignItems: "start" }}>
          <nav className="tm-sticky" aria-label={t("Sections")} style={{ position: "sticky", top: 140, display: "flex", flexDirection: "column", gap: 2, borderInlineStart: "1px solid var(--color-divider)", paddingInlineStart: 4 }}>
            {LEGAL.map((s) => (
              <a key={s.id} href={`#${s.id}`} style={{ fontSize: 14.5, lineHeight: 1.4, padding: "9px 14px", textDecoration: "none", color: "var(--color-neutral-800)" }}>
                {s.title}
              </a>
            ))}
          </nav>
          <div style={{ maxWidth: 760 }}>
            {LEGAL.map((s) => (
              <div key={s.id} id={s.id} style={{ paddingBottom: 34, scrollMarginTop: 150 }}>
                <h2 style={{ fontSize: 28, margin: "0 0 10px" }}>{s.title}</h2>
                {s.paras.map((p) => (
                  <p key={p.slice(0, 24)} style={{ margin: "0 0 14px", fontSize: 15.5, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>{p}</p>
                ))}
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 22, display: "flex", gap: 20, flexWrap: "wrap" }}>
              <Link href="/contact" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, textDecoration: "none" }}>{t("Contact us  ›")}</Link>
              <a href={platformHref("staff")} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, textDecoration: "none" }}>{t("Log in to the platform  ›")}</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
