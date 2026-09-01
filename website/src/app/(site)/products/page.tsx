import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Corners from "@/components/Corners";
import ProductExplorer from "@/components/ProductExplorer";
import { PRODUCTS as PRODUCTS_EN, PRODUCT_UNITY as PRODUCT_UNITY_EN } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Six products, one connected encounter: hospital, clinic, laboratory, radiology, pharmacy and the patient portal, all on the same offline-first record.",
};

export default async function ProductsPage() {
  const { t, content } = await getTranslator();
  const PRODUCTS = content(PRODUCTS_EN);
  const PRODUCT_UNITY = content(PRODUCT_UNITY_EN);
  return (
    <main>
      {/* Hero: the claim on the left, the thing itself on the right. The six
          acronyms sit under the lede as jump links, so the page is navigable
          before the reader scrolls into the cards. */}
      <section style={{ background: "#113055", color: "#FFFFFF", padding: "62px 32px 70px" }}>
        <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.06fr 1fr", gap: 56, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <span className="fs115" style={{ fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF" }}>{t("Products")}</span>
            <h1 style={{ fontSize: "clamp(32px, 5.4vw, 58px)", margin: "14px 0 14px", color: "#FFFFFF", maxWidth: 900 }}>{t("Six products, one connected encounter")}</h1>
            <p style={{ margin: 0, maxWidth: 640, fontSize: 16.5, lineHeight: 1.65, color: "rgba(255,255,255,0.76)" }}>
              {t("From referral hospitals to single-room clinics: every product ties back to the same record, built for intermittent connectivity. Deployed first in South Sudan, designed for health systems across sub-Saharan Africa.")}
            </p>
            <div style={{ width: "100%", marginTop: 30, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
              <span className="fs115" style={{ display: "block", marginBottom: 14, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{t("Jump to a product")}</span>
              <div className="tm-prodchips" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
          <figure className="blueprint tm-figure" style={{ margin: 0, position: "relative", background: "#FFFFFF", padding: 8, borderColor: "rgba(255,255,255,0.28)" }}>
            <Corners light />
            <Image
              src="/assets/platform-front-desk.png"
              alt={t("The TamamHealth front desk: the day's arrivals with times, care team and triage status, beside the reception queue and patient flow")}
              width={3200}
              height={1824}
              sizes="(max-width: 760px) 100vw, 50vw"
              preload
              style={{ width: "100%", height: "auto" }}
            />
            {/* Same line as the figure on /platform, naming the other room. */}
            <figcaption className="fs125" style={{ padding: "9px 5px 2px", lineHeight: 1.5, color: "var(--color-neutral-600)" }}>
              {t("The front desk: the day's arrivals with their times, care team and triage status.")}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* All six products — the tabbed explorer (rail · photo · panel). Every
          panel is the same size, so switching products never shifts the page.
          The light-blue ground lets the active rail tab's white plate read. */}
      <section style={{ padding: "62px 32px 72px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-divider)" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <ProductExplorer />
        </div>
      </section>

      {/* Why six, not one — the three things every product shares underneath. */}
      <section style={{ background: "#113055", color: "#FFFFFF", padding: "74px 32px 80px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <span className="fs115" style={{ fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF" }}>{t("Why six, not one")}</span>
          <h2 style={{ fontSize: "clamp(26px, 3.8vw, 44px)", margin: "16px 0 18px", color: "#FFFFFF", maxWidth: 900 }}>{t("Different rooms, the same file underneath")}</h2>
          <p style={{ margin: 0, maxWidth: 760, fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.76)" }}>
            {t("A pharmacy does not need ward management and a PHCU does not need a modality worklist. What every one of them needs is to read what the last room wrote, so the products differ and the record does not.")}
          </p>
          <div className="tm-g3" style={{ gap: 22, marginTop: 44 }}>
            {PRODUCT_UNITY.map((u) => (
              <div key={u.title} className="blueprint" style={{ position: "relative", padding: "26px 28px 30px", borderColor: "rgba(255,255,255,0.24)" }}>
                <Corners light />
                <h3 style={{ fontSize: 21, margin: "0 0 10px", color: "#FFFFFF" }}>{u.title}</h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.62, color: "rgba(255,255,255,0.72)" }}>{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Route the undecided reader to contact or to the levels-of-care map. */}
      <section style={{ padding: "58px 32px 96px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="blueprint tm-pex-cta" style={{ position: "relative", background: "var(--color-surface)", padding: "40px 46px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
            <Corners />
            <div style={{ maxWidth: 620 }}>
              <h2 style={{ fontSize: "clamp(23px, 2.8vw, 34px)", margin: "0 0 10px" }}>{t("Not sure which one your facility needs?")}</h2>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>
                {t("Tell us the level of care and what you run today. We will map it onto the products and show you the gaps.")}
              </p>
            </div>
            <div className="tm-btn-pair" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/contact" className="btn btn-primary blueprint" style={{ padding: "13px 26px", fontSize: 15, color: "#113055" }}>
                {t("Get in touch")}
                <Corners />
              </Link>
              <Link href="/health-system#levels" className="btn btn-secondary" style={{ padding: "13px 26px", fontSize: 15 }}>
                {t("The six levels of care")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
