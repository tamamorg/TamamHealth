"use client";

/* "What paper costs a facility" — a navy band with a horizontal rail of the
   eight failure cards, each opening its challenge page. */

import Link from "next/link";
import { useRef } from "react";
import Corners from "@/components/Corners";
import { CHALLENGES as CHALLENGES_EN } from "@/lib/site-data";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function ChallengesBand() {
  const { content } = useLanguage();
  const CHALLENGES = content(CHALLENGES_EN);
  const rail = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => rail.current?.scrollBy({ left: d * 336, behavior: "smooth" });

  return (
    <div style={{ background: "#0E2A4A", padding: "56px 52px 52px" }} className="tm-pad-lg">
      <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 8px", color: "#FFFFFF" }}>What paper costs a facility, every single day</h2>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "18px 24px", marginBottom: 28, flexWrap: "wrap" }}>
        <p style={{ margin: 0, maxWidth: 640, fontSize: 15.5, lineHeight: 1.65, color: "rgba(255,255,255,0.78)" }}>
          Open any failure for what it costs today and the steps that replace it.
        </p>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={() => scroll(-1)} aria-label="Previous" className="tm-chalstep" style={{ width: 42, height: 42, border: "1px solid rgba(255,255,255,0.4)", background: "transparent", color: "#FFFFFF", cursor: "pointer", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
          <button type="button" onClick={() => scroll(1)} aria-label="Next" className="tm-chalstep-lit" style={{ width: 42, height: 42, border: "1px solid #7FC4EA", background: "#7FC4EA", color: "#0E2A4A", cursor: "pointer", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        </div>
      </div>
      <div ref={rail} className="tm-chal-rail" style={{ display: "flex", gap: 20, overflowX: "auto", scrollBehavior: "smooth", paddingBottom: 6 }}>
        {CHALLENGES.map((c) => (
          <Link key={c.slug} href={`/challenges/${c.slug}`} className="blueprint tm-chalcard" style={{ flex: "0 0 316px", display: "flex", flexDirection: "column", textDecoration: "none", color: "#FFFFFF", borderColor: "rgba(255,255,255,0.28)" }}>
            <Corners light />
            <div className="tm-figure" style={{ position: "relative", height: 132, borderBottom: "3px solid #7FC4EA" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
              <img src={c.image} alt={c.imageAlt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{ position: "absolute", bottom: 0, left: 0, zIndex: 3, background: "#7FC4EA", padding: "8px 10px 6px", display: "flex" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E2A4A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={c.d}></path>{c.d2 ? <path d={c.d2}></path> : null}</svg>
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "20px 22px", flex: 1 }}>
              <h3 style={{ fontSize: 18.5, margin: 0, lineHeight: 1.25, color: "#FFFFFF" }}>{c.title}</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.76)" }}>{c.short}</p>
              <span className="fs125" style={{ marginTop: "auto", paddingTop: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7FC4EA" }}>Learn more →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
