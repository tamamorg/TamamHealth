import type { Metadata } from "next";
import Link from "next/link";
import Corners from "@/components/Corners";
import { PRODUCTS } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Six products, one connected encounter — hospital, clinic, laboratory, radiology, pharmacy and the patient portal, all on the same offline-first record.",
};

export default function ProductsPage() {
  return (
    <main>
      <section style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "74px 32px 78px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(32px, 5.4vw, 58px)", margin: "0 0 12px", color: "#FFFFFF", maxWidth: 900 }}>Six products, one connected encounter</h1>
          <p style={{ margin: 0, maxWidth: 680, fontSize: 16.5, lineHeight: 1.65, color: "rgba(255,255,255,0.76)" }}>
            From referral hospitals to single-room clinics — every product ties back to the same record, built for intermittent
            connectivity. Deployed first in South Sudan, designed for health systems across sub-Saharan Africa.
          </p>
        </div>
      </section>
      <section style={{ padding: "70px 32px 96px" }}>
        <div className="tm-g3" style={{ maxWidth: 1320, margin: "0 auto", gap: 34 }}>
          {PRODUCTS.map((p) => (
            <Link key={p.slug} href={`/products/${p.slug}`} className="blueprint tm-prodcard" style={{ display: "flex", flexDirection: "column", background: "#FFFFFF", textDecoration: "none", color: "inherit" }}>
              <Corners />
              <div className="tm-figure" style={{ position: "relative", height: 200, borderBottom: `3px solid ${p.accent}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
                <img src={p.image} alt={p.imageAlt} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 25%" }} />
                <span style={{ position: "absolute", top: 0, right: 0, zIndex: 3, background: p.accent, color: "#FFFFFF", fontSize: 13, letterSpacing: "0.1em", padding: "8px 14px" }}>{p.acronym}</span>
              </div>
              <div style={{ padding: "26px 26px 28px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                <h3 style={{ fontSize: 25, margin: 0 }}>{p.title}</h3>
                <span className="fs115" style={{ fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: p.accent }}>{p.tagline}</span>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{p.description}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 16, borderTop: "1px solid var(--color-divider)" }}>
                  {p.modules.map((m) => (
                    <span key={m} className="tag" style={{ color: p.accent, background: "rgba(1,86,151,0.11)" }}>{m}</span>
                  ))}
                </div>
                <span style={{ marginTop: "auto", paddingTop: 18, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: p.accent }}>How it works →</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
