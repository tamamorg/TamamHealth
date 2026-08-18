import type { Metadata } from "next";
import Link from "next/link";
import Corners from "@/components/Corners";
import { PRODUCTS as PRODUCTS_EN } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Six products, one connected encounter — hospital, clinic, laboratory, radiology, pharmacy and the patient portal, all on the same offline-first record.",
};

/* How many module tags a card shows before it collapses into "+N more".
   HMIS carries nine and PPS five, so uncapped the six cards ran to wildly
   different heights and the "How it works" rows never lined up. */
const TAGS_SHOWN = 4;

export default async function ProductsPage() {
  const { t, content } = await getTranslator();
  const PRODUCTS = content(PRODUCTS_EN);
  return (
    <main>
      {/* Hero: the claim on the left, the thing itself on the right. The six
          acronyms sit under the lede as jump links, so the page is navigable
          before the reader scrolls into the cards. */}
      <section style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "62px 32px 70px" }}>
        <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.06fr 1fr", gap: 56, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <span className="fs115" style={{ fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7FC4EA" }}>{t("Products")}</span>
            <h1 style={{ fontSize: "clamp(32px, 5.4vw, 58px)", margin: "14px 0 14px", color: "#FFFFFF", maxWidth: 900 }}>{t("Six products, one connected encounter")}</h1>
            <p style={{ margin: 0, maxWidth: 640, fontSize: 16.5, lineHeight: 1.65, color: "rgba(255,255,255,0.76)" }}>
              {t("From referral hospitals to single-room clinics — every product ties back to the same record, built for intermittent connectivity. Deployed first in South Sudan, designed for health systems across sub-Saharan Africa.")}
            </p>
            <div style={{ width: "100%", marginTop: 30, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
              <span className="fs115" style={{ display: "block", marginBottom: 14, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{t("Jump to a product")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PRODUCTS.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/products/${p.slug}`}
                    className="tm-prodchip"
                    title={p.title}
                    style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 13, letterSpacing: "0.1em", color: "#FFFFFF", textDecoration: "none", padding: "8px 14px", border: "1px solid rgba(255,255,255,0.32)" }}
                  >
                    {p.acronym}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="blueprint tm-figure" style={{ position: "relative", background: "#FFFFFF", padding: 8, borderColor: "rgba(255,255,255,0.28)" }}>
            <Corners light />
            {/* eslint-disable-next-line @next/next/no-img-element -- product screenshot, natural ratio */}
            <img src="/assets/platform-doctor.png" alt={t("The TamamHealth clinical workspace: a doctor's patient list for the day with acuity, care team and outstanding items")} style={{ width: "100%", display: "block" }} />
          </div>
        </div>
      </section>

      <section style={{ padding: "64px 32px 96px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20, paddingBottom: 18, marginBottom: 34, borderBottom: "1px solid var(--color-divider)" }}>
            <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0 }}>{t("All six products")}</h2>
            <span className="fs125" style={{ letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>{t("One record · offline-first")}</span>
          </div>
          <div className="tm-g3" style={{ gap: 34 }}>
            {PRODUCTS.map((p) => (
              <Link key={p.slug} href={`/products/${p.slug}`} className="blueprint tm-prodcard" style={{ display: "flex", flexDirection: "column", background: "#FFFFFF", textDecoration: "none", color: "inherit" }}>
                <Corners />
                <div className="tm-figure" style={{ position: "relative", height: 190, borderBottom: `3px solid ${p.accent}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
                  <img src={p.image} alt={p.imageAlt} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 25%" }} />
                </div>
                <div style={{ padding: "22px 24px 24px", display: "flex", flexDirection: "column", gap: 11, flex: 1 }}>
                  {/* The acronym chip, not the photograph, is what identifies a
                      card on a phone — the figure above is hidden there. */}
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 9 }}>
                    <span className="fs115" style={{ fontFamily: "var(--font-heading)", fontWeight: 700, letterSpacing: "0.1em", color: "#FFFFFF", background: p.accent, padding: "4px 9px" }}>{p.acronym}</span>
                    <span className="fs115" style={{ fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{p.tagline}</span>
                  </div>
                  <h3 style={{ fontSize: 23, lineHeight: 1.2, margin: 0 }}>{p.title}</h3>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{p.description}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                    {p.modules.slice(0, TAGS_SHOWN).map((m) => (
                      <span key={m} className="tag" style={{ color: p.accent, background: "rgba(1,86,151,0.11)" }}>{m}</span>
                    ))}
                    {p.modules.length > TAGS_SHOWN && (
                      <span className="tag" style={{ color: "var(--color-neutral-600)", background: "var(--color-surface)", border: "1px solid var(--color-divider)" }}>
                        +{p.modules.length - TAGS_SHOWN} more
                      </span>
                    )}
                  </div>
                  {/* marginTop:auto pins this row to the card's bottom edge, so
                      the six cards line up however long their copy runs. */}
                  <div style={{ marginTop: "auto", paddingTop: 18, borderTop: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: p.accent }}>{t("How it works")}</span>
                    <span aria-hidden="true" style={{ fontSize: 16, color: p.accent }}>→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
