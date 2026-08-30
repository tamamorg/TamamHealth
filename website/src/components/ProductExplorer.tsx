"use client";

/* /products — "All six products" as a tabbed explorer: a rail of the six on
 * the left, one large photograph, and a detail panel on the right. Every
 * product's panel is rendered into the SAME grid cell, so the panel (and the
 * photo beside it, which stretches to match) is always as tall as the wordiest
 * product — HMIS, with nine modules. Switching products only swaps the photo
 * and cross-fades opacity; nothing resizes, so the section never glitches.
 * On a phone the rail becomes a scroll of chips above the photo, and the ‹ ›
 * steppers stay in the header. */

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { PRODUCTS as PRODUCTS_EN } from "@/lib/site-data";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function ProductExplorer() {
  const { t, content } = useLanguage();
  const PRODUCTS = content(PRODUCTS_EN);
  const [i, setI] = useState(0);
  const p = PRODUCTS[i];
  const step = (d: number) => setI((i + PRODUCTS.length + d) % PRODUCTS.length);

  return (
    <div>
      {/* Header: intro on the left, steppers on the right */}
      <div className="tm-pex-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 28, flexWrap: "wrap", paddingBottom: 18, marginBottom: 30, borderBottom: "1px solid var(--color-divider)" }}>
        <div>
          <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: "0 0 12px" }}>{t("All six products")}</h2>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 15.5, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>
            {t("A pharmacy does not need ward management and a PHCU does not need a modality worklist. Pick a product to see what it runs and where.")}
          </p>
        </div>
        <div className="tm-pex-steppers" style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button type="button" className="btn btn-secondary btn-icon" onClick={() => step(-1)} aria-label={t("Previous product")}>‹</button>
          <button type="button" className="btn btn-secondary btn-icon" onClick={() => step(1)} aria-label={t("Next product")}>›</button>
        </div>
      </div>

      <div className="tm-pex-body" style={{ display: "grid", gridTemplateColumns: "212px minmax(0, 1fr) minmax(0, 1.12fr)", columnGap: 38, alignItems: "stretch" }}>
        {/* Rail */}
        <div className="tm-pex-rail" style={{ display: "flex", flexDirection: "column" }}>
          {PRODUCTS.map((x, n) => {
            const on = n === i;
            return (
              <button
                key={x.slug}
                type="button"
                onClick={() => setI(n)}
                className="tm-pex-tab"
                aria-current={on ? "true" : undefined}
                style={{ appearance: "none", border: 0, cursor: "pointer", textAlign: "start", background: on ? "#FFFFFF" : "transparent", padding: "13px 18px", display: "flex", flexDirection: "column", gap: 3 }}
              >
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 16, letterSpacing: "0.04em", color: on ? x.accent : "var(--color-text)" }}>{x.acronym}</span>
                <span className="fs12" style={{ letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{x.sector}</span>
              </button>
            );
          })}
        </div>

        {/* Photo — one element, swaps with the active product; the cell
            stretches to the panel's (tallest) height so it never resizes. */}
        <div className="tm-pex-photo" style={{ position: "relative", minHeight: 470, overflow: "hidden" }}>
          <Image
            src={p.image}
            alt={p.imageAlt}
            fill
            sizes="(max-width: 820px) 100vw, 40vw"
            style={{ objectFit: "cover", objectPosition: "center 25%" }}
          />
          <span className="fs115" style={{ position: "absolute", left: 0, bottom: 0, background: "var(--color-accent-300)", color: "#113055", padding: "8px 14px 7px", letterSpacing: "0.13em", textTransform: "uppercase", fontWeight: 700 }}>{p.imageCaption}</span>
        </div>

        {/* Detail panel — all six overlaid in one grid cell; only the active
            one shows, the rest hold the height open. */}
        <div className="tm-pex-panel" style={{ display: "grid" }}>
          {PRODUCTS.map((x, n) => {
            const on = n === i;
            return (
              <div
                key={x.slug}
                aria-hidden={!on}
                style={{ gridArea: "1 / 1", display: "flex", flexDirection: "column", gap: 14, opacity: on ? 1 : 0, pointerEvents: on ? "auto" : "none", transition: "opacity 0.3s ease" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ background: x.accent, color: "#FFFFFF", fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", padding: "5px 11px" }}>{x.acronym}</span>
                  <span className="fs12" style={{ letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-neutral-600)", fontWeight: 700 }}>{t("{{n}} modules", { n: String(x.modules.length) })}</span>
                </div>
                <h3 style={{ fontSize: "clamp(24px, 2.6vw, 32px)", lineHeight: 1.15, margin: 0 }}>{x.title}</h3>
                <span className="fs115" style={{ letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)", fontWeight: 700 }}>{x.tagline}</span>
                <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{x.description}</p>

                <ul style={{ listStyle: "none", margin: "2px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
                  {x.highlights.map((hgl) => (
                    <li key={hgl} style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 15, lineHeight: 1.5, color: "var(--color-text)" }}>
                      <span aria-hidden="true" style={{ flexShrink: 0, width: 9, height: 9, background: "var(--tm-orange, #ff7f00)", transform: "translateY(1px)" }} />
                      {hgl}
                    </li>
                  ))}
                </ul>

                <div style={{ marginTop: 6 }}>
                  <span className="fs12" style={{ display: "block", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-neutral-600)", fontWeight: 700, paddingBottom: 12, borderBottom: "1px solid var(--color-divider)" }}>{t("Modules included")}</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 26 }}>
                    {x.modules.map((m) => (
                      <span key={m} style={{ display: "flex", gap: 11, alignItems: "center", fontSize: 14.5, padding: "13px 0", borderBottom: "1px solid var(--color-divider)" }}>
                        <span aria-hidden="true" style={{ flexShrink: 0, width: 8, height: 8, background: x.accent }} />
                        {m}
                      </span>
                    ))}
                  </div>
                </div>

                <Link href={`/products/${x.slug}`} tabIndex={on ? 0 : -1} style={{ marginTop: 8, fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 16, color: x.accent, textDecoration: "none" }}>
                  {t("Learn more ›")}
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
