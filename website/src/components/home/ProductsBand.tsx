"use client";

/* Home products band — the dark tabbed panel. The left rail lists the six
   products; the white card overlaps the navy/grey gradient split via a
   negative top margin (desktop only; ≤1100px it stacks). */

import Link from "next/link";
import { useState } from "react";
import Corners from "@/components/Corners";
import HeroNav from "@/components/HeroNav";
import { PRODUCTS as PRODUCTS_EN } from "@/lib/site-data";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function ProductsBand() {
  const { content } = useLanguage();
  const PRODUCTS = content(PRODUCTS_EN);
  const [prod, setProd] = useState(0);
  const p = PRODUCTS[prod];
  const step = (d: number) => setProd((prod + PRODUCTS.length + d) % PRODUCTS.length);

  return (
    <section id="products" className="tm-products-band" style={{ position: "relative" }}>
      <div className="tm-inset" style={{ position: "relative", maxWidth: 1320, margin: "0 auto", padding: "0 32px 34px" }}>
        <div className="tm-prod-grid" style={{ display: "grid", gridTemplateColumns: "425px 1fr", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", padding: "41px 0 0" }}>
            <h2 style={{ fontSize: "clamp(26px, 2.6vw, 34px)", margin: 0, color: "#FFFFFF", letterSpacing: "-0.01em" }}>Products</h2>
            {/* Desktop product picker. Hidden under 760px, where HeroNav below
                takes over the same job in a form that fits the width. */}
            <div className="tm-prod-tabs" style={{ display: "flex", flexDirection: "column", marginTop: 87 }}>
              {PRODUCTS.map((t, i) => (
                <button
                  key={t.slug}
                  onClick={() => setProd(i)}
                  className="tm-tab"
                  style={{
                    appearance: "none", background: "none", border: 0, textAlign: "start", cursor: "pointer",
                    fontFamily: "var(--font-body)",
                    fontWeight: i === prod ? 700 : 400,
                    fontSize: 15, letterSpacing: "0.045em", textTransform: "uppercase", padding: "12px 0",
                    color: i === prod ? "#FFFFFF" : "rgba(255,255,255,0.55)",
                  }}
                >
                  {t.title}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div className="tm-desk-steppers" style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "41px 0 0" }}>
              <button onClick={() => step(-1)} aria-label="Previous product" style={{ appearance: "none", cursor: "pointer", width: 38, height: 38, border: 0, background: "#BBD9EC", color: "#FFFFFF", fontSize: 16, display: "grid", placeItems: "center" }}>‹</button>
              <button onClick={() => step(1)} aria-label="Next product" style={{ appearance: "none", cursor: "pointer", width: 38, height: 38, border: 0, background: "#015697", color: "#FFFFFF", fontSize: 16, display: "grid", placeItems: "center" }}>›</button>
            </div>
          </div>
        </div>

        <div className="tm-prod-card blueprint" style={{ position: "relative", marginTop: -326, marginInlineStart: 425, background: "#FFFFFF", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch" }}>
          <Corners />
          <div className="tm-prod-photo" style={{ position: "relative", minHeight: 420 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
            <img src={p.image} alt={p.imageAlt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 25%" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 46px" }}>
            <h3 style={{ fontSize: "clamp(24px, 2.6vw, 32px)", margin: "0 0 18px" }}>{p.title}</h3>
            <p style={{ margin: "0 0 26px", fontSize: 16, lineHeight: 1.62, color: "var(--color-neutral-800)" }}>{p.description}</p>
            <Link href={`/products/${p.slug}`} style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 17, color: p.accent, textDecoration: "none" }}>
              Learn more &nbsp;›
            </Link>
          </div>
        </div>

        <HeroNav
          items={PRODUCTS.map((t) => ({ key: t.slug, label: t.acronym }))}
          active={prod}
          onPick={setProd}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          prevLabel="Previous product"
          nextLabel="Next product"
          style={{ marginTop: 22 }}
        />
      </div>
    </section>
  );
}
