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
  note: "Pilot launch site — the 10-clinic pilot begins in Juba and greater South Sudan.",
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
    <section id="footprint" style={{ padding: "90px 32px 80px", background: "#FFFFFF" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <h2 style={{ fontSize: "clamp(27px, 4vw, 44px)", margin: 0, maxWidth: 760 }}>{t("Starting in Juba, built to scale across sub-Saharan Africa")}</h2>
          <span className="tm-rule" style={{ display: "block", width: 380, height: 3, background: "var(--color-accent)" }} />
          <p style={{ margin: 0, maxWidth: 640, fontSize: 15.5, lineHeight: 1.65, color: "var(--color-neutral-700)" }}>
            {emphasise(t("We’re raising **$100,000** to launch TamamHealth in 10 clinics across Juba and greater South Sudan — proof that offline-first digital records can work in the hardest conditions, and a foundation built to scale across sub-Saharan Africa."))}
          </p>
        </div>
        <div className="tm-map tm-split" style={{ position: "relative", marginTop: 34, display: "grid", gridTemplateColumns: "400px 1fr", alignItems: "center", gap: 0 }}>
          {/* Desktop site detail. Hidden under 760px: stacked above the map it
              pushed the map itself below the fold, and HeroNav already names
              the selected site. */}
          <div className="blueprint tm-site-card" style={{ background: "var(--color-surface)", padding: "34px 32px 30px", zIndex: 2 }}>
            <Corners />
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>{site.tier}</span>
            <h3 style={{ fontSize: 30, margin: "8px 0 4px" }}>{site.name}</h3>
            <span style={{ fontSize: 13, color: "var(--color-neutral-600)" }}>{site.state}</span>
            <p style={{ margin: "16px 0 20px", fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{site.note}</p>
            <div className="tm-desk-steppers" style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-icon" onClick={() => select(site.index - 1)} aria-label={t("Previous site")}>‹</button>
              <button className="btn btn-secondary btn-icon" onClick={() => select(site.index + 1)} aria-label={t("Next site")}>›</button>
            </div>
          </div>
          <iframe
            ref={frameRef}
            src="/map-south-sudan.html"
            title={t("Map of South Sudan showing pilot and planned sites")}
            style={{ width: "100%", height: 560, border: 0, marginInlineStart: -60 }}
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
              <span style={{ color: "var(--color-text)", fontWeight: 600, letterSpacing: "0.02em", textTransform: "none" }}>{site.name}</span>
            </span>
          }
        />
      </div>
    </section>
  );
}
