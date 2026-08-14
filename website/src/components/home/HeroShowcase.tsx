"use client";

/* Home hero + insight strip. The four strip cards select which hero shows;
   on phones the strip becomes a snap carousel driven by the ‹ dashes › bar
   directly under the hero. */

import Link from "next/link";
import { useState } from "react";
import Corners from "@/components/Corners";
import HeroNav from "@/components/HeroNav";
import { HEROES } from "@/lib/site-data";

export default function HeroShowcase() {
  const [hero, setHero] = useState(0);
  const h = HEROES[hero];

  const scrollRail = (i: number) => {
    const r = document.getElementById("tm-strip-rail");
    if (r && r.scrollWidth > r.clientWidth + 4) r.scrollTo({ left: i * r.clientWidth, behavior: "smooth" });
  };
  const go = (i: number) => {
    setHero(i);
    scrollRail(i);
  };
  const step = (d: number) => go((hero + HEROES.length + d) % HEROES.length);

  return (
    <>
      {/* Hero */}
      <section className="tm-hero" style={{ position: "relative", height: "clamp(455px, calc(100vh - 340px), 740px)", overflow: "hidden", background: "var(--color-accent-900)" }}>
        <div className="tm-hero-img tm-figure" style={{ position: "absolute", inset: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed hero, sized by CSS */}
          <img src={h.image} alt={h.alt} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 35%" }} />
        </div>
        <div className="tm-hero-scrim" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(1,86,151,0.42) 0%, rgba(1,86,151,0.06) 62%, rgba(1,86,151,0.22) 100%)" }} />
        <div className="tm-hero-wrap" style={{ position: "relative", maxWidth: 1320, margin: "0 auto", padding: "0 32px", height: "100%", display: "flex", alignItems: "center" }}>
          <div className="blueprint tm-hero-card" style={{ width: "min(608px, 100%)", background: "rgba(255,255,255,0.92)", padding: "36px 44px 38px", display: "flex", flexDirection: "column", gap: 16 }}>
            <Corners />
            <h1 style={{ fontSize: "clamp(29px, 4.6vw, 46px)", lineHeight: 1.08, margin: 0, letterSpacing: "-0.02em" }}>{h.title}</h1>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{h.body}</p>
            <div className="tm-hero-btns" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
              <Link href={h.href} className="btn btn-primary blueprint" style={{ padding: "13px 26px", fontSize: 15, color: "#0E2A4A" }}>
                Learn more
                <Corners />
              </Link>
              <Link href="/products" className="btn btn-secondary" style={{ padding: "13px 26px", fontSize: 15 }}>
                Our Solution
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* mobile hero carousel control */}
      <HeroNav
        items={HEROES.map((x) => ({ key: x.stripKicker, label: x.stripKicker }))}
        active={hero}
        onPick={go}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        prevLabel="Previous slide"
        nextLabel="Next slide"
      />

      {/* News / insight strip */}
      <section className="tm-strip-section" style={{ borderBottom: "1px solid var(--color-divider)", background: "#FFFFFF" }}>
        <div id="tm-strip-rail" className="tm-strip-rail" style={{ maxWidth: 1320, margin: "0 auto", padding: "0 32px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {HEROES.map((s, i) => (
            <button
              key={s.stripKicker}
              onClick={() => go(i)}
              className="tm-card"
              style={{
                appearance: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit",
                padding: "22px 26px 28px", border: 0,
                borderLeft: "1px solid var(--color-divider)", borderTop: "1px solid var(--color-divider)",
                background: i === hero ? "rgba(1,86,151,0.09)" : "transparent",
                display: "flex", flexDirection: "column", gap: 11, minHeight: 132,
              }}
            >
              <span className="fs12" style={{ letterSpacing: "0.13em", textTransform: "uppercase", color: s.accent, fontWeight: 700 }}>{s.stripKicker}</span>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, lineHeight: 1.25 }}>{s.stripTitle}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
