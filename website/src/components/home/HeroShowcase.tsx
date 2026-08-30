"use client";

/* Home hero + insight strip. The four strip cards select which hero shows;
   on phones the strip becomes a snap carousel driven by the ‹ dashes › bar
   directly under the hero. */

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import Corners from "@/components/Corners";
import HeroNav from "@/components/HeroNav";
import { HEROES as HEROES_EN } from "@/lib/site-data";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { emphasise } from "@/components/emphasise";

export default function HeroShowcase() {
  const { t, content } = useLanguage();
  const HEROES = content(HEROES_EN);
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
      {/* Fixed height, so the photograph is the same size on every slide — the
          card is what changes with its text, not the picture. The 500px floor
          is set by the longest slide: at 455px the problem card's body ran past
          the bottom of the band on a short laptop screen and was clipped. */}
      <section className="tm-hero" style={{ position: "relative", height: "clamp(500px, calc(100vh - 340px), 740px)", overflow: "hidden", background: "var(--color-accent-900)" }}>
        <div className="tm-hero-img tm-figure" style={{ position: "absolute", inset: 0 }}>
          <Image
            src={h.image}
            alt={h.alt}
            fill
            sizes="100vw"
            preload={hero === 0}
            style={{ objectFit: "cover", objectPosition: h.focus ?? "center 35%" }}
          />
        </div>
        <div className="tm-hero-scrim" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(1,86,151,0.42) 0%, rgba(1,86,151,0.06) 62%, rgba(1,86,151,0.22) 100%)" }} />
        <div className="tm-hero-wrap" style={{ position: "relative", maxWidth: 1320, margin: "0 auto", padding: "0 32px", height: "100%", display: "flex", alignItems: "center" }}>
          {/* Every slide's card is rendered into the SAME grid cell, so the
              stack is always as tall as the wordiest slide and never resizes
              when you switch tabs — only opacity cross-fades. Just the active
              card is visible and focusable; the rest hold the height open so
              the panel and the photograph behind it stay put. "Our Solution"
              always resolves to /platform (the page that answers the problem
              failure by failure), landing at its top — not /products, the
              catalogue, and not #solution, which drops the reader mid-argument. */}
          <div className="tm-hero-cardstack" style={{ display: "grid", width: "min(608px, 100%)" }}>
            {HEROES.map((hh, i) => {
              const on = i === hero;
              return (
                <div
                  key={hh.stripKicker}
                  className="blueprint tm-hero-card"
                  aria-hidden={!on}
                  style={{ gridArea: "1 / 1", background: "rgba(255,255,255,0.92)", padding: "36px 44px 38px", display: "flex", flexDirection: "column", gap: 16, opacity: on ? 1 : 0, pointerEvents: on ? "auto" : "none", transition: "opacity 0.32s ease" }}
                >
                  <Corners />
                  <h1 style={{ fontSize: "clamp(29px, 4.6vw, 46px)", lineHeight: 1.08, margin: 0, letterSpacing: "-0.02em" }}>{hh.title}</h1>
                  <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{emphasise(hh.body)}</p>
                  <div className="tm-hero-btns" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                    <Link href={hh.href} className="btn btn-primary blueprint" tabIndex={on ? 0 : -1} style={{ padding: "13px 26px", fontSize: 15, color: "#113055" }}>
                      {t("Learn more")}
                      <Corners />
                    </Link>
                    <Link href="/platform" className="btn btn-secondary" tabIndex={on ? 0 : -1} style={{ padding: "13px 26px", fontSize: 15 }}>
                      {t("Our Solution")}
                    </Link>
                  </div>
                </div>
              );
            })}
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
                appearance: "none", cursor: "pointer", textAlign: "start", font: "inherit", color: "inherit",
                padding: "22px 26px 28px", border: 0,
                borderInlineStart: "1px solid var(--color-divider)", borderTop: "1px solid var(--color-divider)",
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
