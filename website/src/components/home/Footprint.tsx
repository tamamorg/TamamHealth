"use client";

/* Deployment footprint — the D3 map lives in a same-origin iframe
   (/map-south-sudan.html) and posts the hovered/selected site up to this
   card; the steppers post a select message back down. */

import { useEffect, useRef, useState } from "react";
import { emphasise } from "@/components/emphasise";
import Corners from "@/components/Corners";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import HeroNav from "@/components/HeroNav";

interface Site {
  index: number;
  name: string;
  state: string;
  tier: string;
  note: string;
  pilot?: boolean;
}

const SITE_COUNT = 11;

const DEFAULT_SITE: Site = {
  index: 0,
  name: "Juba",
  state: "Central Equatoria",
  tier: "Referral / teaching tier",
  note: "Pilot launch site: the 10-clinic pilot begins in Juba and greater South Sudan.",
  pilot: true,
};

export default function Footprint() {
  const { t } = useLanguage();
  const [site, setSite] = useState<Site>(DEFAULT_SITE);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // The map is served from this origin; ignore anything else.
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (d && d.type === "site" && typeof d.index === "number") setSite(d as Site);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const select = (i: number) => {
    frameRef.current?.contentWindow?.postMessage({ type: "select", index: (i + SITE_COUNT) % SITE_COUNT }, window.location.origin);
  };

  return (
    <section id="footprint" style={{ padding: "84px 32px 76px", background: "#FFFFFF" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        {/* Two columns: the plan and the selected site on the left, the map
            on the right, so the map fills the width the old centred heading
            left empty. */}
        <div className="tm-map tm-split" style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.25fr)", alignItems: "center", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, zIndex: 2 }}>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{t("Deployment")}</span>
            <h2 style={{ fontSize: "clamp(27px, 3.4vw, 42px)", margin: 0 }}>{t("Initial deployment in Juba, designed to scale across sub-Saharan Africa")}</h2>
            <span style={{ display: "block", width: 100, height: 3, background: "var(--color-accent)" }} />
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.65, color: "var(--color-neutral-700)" }}>
              {emphasise(t("TamamHealth is raising **$100,000** to launch in 10 clinics across Juba and greater South Sudan, to demonstrate that offline-first digital records can operate in the most demanding conditions and to establish a foundation for expansion across sub-Saharan Africa."))}
            </p>
            <dl className="tm-fp-figures" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", margin: "6px 0 4px", borderTop: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)" }}>
              {[
                { v: t("10"), k: t("pilot clinics") },
                { v: t("$100K"), k: t("pilot goal") },
                { v: t("6"), k: t("levels of care") },
              ].map((f, i) => (
                <div key={f.k} style={{ padding: "14px 0 14px", paddingInlineStart: i ? 18 : 0, borderInlineStart: i ? "1px solid var(--color-divider)" : 0 }}>
                  <dt style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 34, lineHeight: 1, color: "var(--tm-deep)" }}>{f.v}</dt>
                  <dd style={{ margin: "6px 0 0", fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>{f.k}</dd>
                </div>
              ))}
            </dl>
            {/* Desktop site detail. Hidden under 760px: HeroNav below names
                the selected site there. */}
            <div className="blueprint tm-site-card" style={{ background: "var(--color-surface)", padding: "24px 26px 22px" }}>
              <Corners />
              <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>{t(site.tier)}</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "6px 0 2px" }}>
                <h3 style={{ fontSize: 26, margin: 0 }}>{t(site.name)}</h3>
                <span style={{ fontSize: 13, color: "var(--color-neutral-600)" }}>{t(site.state)}</span>
              </div>
              <p style={{ margin: "10px 0 16px", fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{t(site.note)}</p>
              <div className="tm-desk-steppers" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="btn btn-secondary btn-icon" onClick={() => select(site.index - 1)} aria-label={t("Previous site")}>‹</button>
                <button className="btn btn-secondary btn-icon" onClick={() => select(site.index + 1)} aria-label={t("Next site")}>›</button>
                <span style={{ marginInlineStart: 8, fontSize: 12.5, letterSpacing: "0.1em", color: "var(--color-neutral-600)" }}>{site.index + 1} / {SITE_COUNT}</span>
              </div>
            </div>
          </div>
          <iframe
            ref={frameRef}
            src="/map-south-sudan.html"
            title={t("Map of South Sudan showing pilot and planned sites")}
            style={{ width: "100%", height: 600, border: 0 }}
          />
        </div>
        <HeroNav
          items={[]}
          active={site.index}
          onPick={select}
          onPrev={() => select(site.index - 1)}
          onNext={() => select(site.index + 1)}
          prevLabel="Previous site"
          nextLabel="Next site"
          style={{ marginTop: 18 }}
          center={
            <span style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 14px", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
              {site.index + 1} / {SITE_COUNT}
              <span style={{ color: "var(--color-text)", fontWeight: 600, letterSpacing: "0.02em", textTransform: "none" }}>{t(site.name)}</span>
            </span>
          }
        />
      </div>
    </section>
  );
}
