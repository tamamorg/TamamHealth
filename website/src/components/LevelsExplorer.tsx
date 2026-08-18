"use client";

/* The six levels of care — vertical rail of tiers driving one large figure
   with an overlay card; ‹ dashes › bar replaces the steppers on phones. */

import { useState } from "react";
import Corners from "@/components/Corners";
import HeroNav from "@/components/HeroNav";
import { CARE_LEVELS as CARE_LEVELS_EN, careLevelLabel } from "@/lib/site-data";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LevelsExplorer() {
  const { t, content } = useLanguage();
  const CARE_LEVELS = content(CARE_LEVELS_EN);
  const [level, setLevel] = useState(0);
  const lv = CARE_LEVELS[level];
  const step = (d: number) => setLevel((level + CARE_LEVELS.length + d) % CARE_LEVELS.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 28, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: "clamp(25px, 3.6vw, 40px)", margin: "0 0 10px" }}>{t("The six levels of care")}</h2>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "var(--color-neutral-700)" }}>
            {t("From the community health worker to the national referral hospital. Tamam covers every tier, so a patient’s record follows them up and down the referral chain.")}
          </p>
        </div>
        <div className="tm-desk-steppers" style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => step(-1)} aria-label={t("Previous level")}>‹</button>
          <button className="btn btn-secondary btn-icon" onClick={() => step(1)} aria-label={t("Next level")}>›</button>
        </div>
      </div>
      <HeroNav
        items={CARE_LEVELS.map((c) => ({ key: c.level, label: c.level }))}
        active={level}
        onPick={setLevel}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        prevLabel="Previous level"
        nextLabel="Next level"
        style={{ marginTop: 22 }}
      />
      <div className="tm-split" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 40, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {CARE_LEVELS.map((c, i) => (
            <button
              key={c.level}
              onClick={() => setLevel(i)}
              className="tm-lvlbtn"
              style={{
                appearance: "none", border: 0,
                background: i === level ? "#FFFFFF" : "transparent",
                cursor: "pointer", textAlign: "start",
                fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, letterSpacing: "0.02em",
                padding: "14px 18px",
                color: i === level ? "var(--color-text)" : "var(--color-neutral-600)",
              }}
            >
              {careLevelLabel(c)}
            </button>
          ))}
        </div>
        <div className="blueprint" style={{ position: "relative", height: 500 }}>
          <Corners />
          {/* eslint-disable-next-line @next/next/no-img-element -- explorer figure, sized by CSS */}
          <img src={lv.image} alt={lv.alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(1,86,151,0.72) 0%, rgba(1,86,151,0.06) 74%)" }} />
          <div style={{ position: "absolute", left: 40, top: "50%", transform: "translateY(-50%)", width: "min(440px, 72%)", background: "rgba(1,86,151,0.92)", padding: "32px 32px 34px", color: "#FFFFFF" }}>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-300)" }}>{t("Level {{n}}", { n: String(level + 1).padStart(2, "0") })}</span>
            <h3 style={{ fontSize: 30, margin: "10px 0 10px", color: "#FFFFFF" }}>{lv.level}</h3>
            <p style={{ margin: "0 0 18px", fontSize: 15.5, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>{lv.role}</p>
            <span className="fs12" style={{ letterSpacing: "0.1em", textTransform: "uppercase", color: "#FFFFFF", background: lv.tone, padding: "7px 13px", display: "inline-block" }}>
              {t("Served by {{product}}", { product: lv.product })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
