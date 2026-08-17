import type { Metadata } from "next";
import Link from "next/link";
import Corners from "@/components/Corners";
import { PLATFORM_FACTS, PLATFORM_FLOW, PLATFORM_PANELS, PLATFORM_PILLARS } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "The Platform",
  description:
    "One offline-first patient record from the front desk to the Ministry — simple enough for the front desk, strong enough for the nation.",
};

export default function PlatformPage() {
  return (
    <main>
      <section style={{ background: "#015697", color: "#FFFFFF", padding: "60px 32px 74px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="tm-platform-split" style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 56, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }}>
              <h1 style={{ fontSize: "clamp(31px, 5vw, 54px)", margin: 0, color: "#FFFFFF" }}>One record, from the front desk to the Ministry</h1>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", maxWidth: 660 }}>
                Simple enough for the front desk. Strong enough for the nation. Everything the paper system loses — history, time,
                trust — Tamam keeps. One offline-first record that follows the patient through every visit.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", marginTop: 6 }}>
                <Link href="/contact" className="btn blueprint" style={{ padding: "14px 28px", fontSize: 15.5, background: "#FFFFFF", borderColor: "#FFFFFF", color: "#015697" }}>
                  Get in touch
                  <Corners />
                </Link>
                <Link href="/products" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, color: "#7FC4EA", textDecoration: "none" }}>
                  See the six products →
                </Link>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {PLATFORM_FACTS.map((f) => (
                <div key={f.value} className="blueprint tm-fact" style={{ padding: "20px 24px", borderColor: "rgba(255,255,255,0.28)" }}>
                  <Corners light />
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 30, lineHeight: 1, color: "#7FC4EA" }}>{f.value}</span>
                  <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>{f.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="dashboard" style={{ padding: "74px 32px 20px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20, paddingBottom: 18, borderBottom: "1px solid var(--color-divider)" }}>
            <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0 }}>The facility dashboard</h2>
            <span className="fs125" style={{ letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>Reception, on a real patient day</span>
          </div>
          <div className="tm-dash-grid" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 48, alignItems: "start", marginTop: 34 }}>
            <div className="blueprint" style={{ position: "relative" }}>
              <Corners />
              {/* eslint-disable-next-line @next/next/no-img-element -- product screenshot, natural ratio */}
              <img src="/assets/platform-receptionist.png" alt="The TamamHealth reception dashboard: today's schedule, patient flow and triage queue" style={{ width: "100%", display: "block" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {PLATFORM_PANELS.map((p) => (
                <div key={p.t} style={{ padding: "16px 0", borderBottom: "1px solid var(--color-divider)" }}>
                  <h3 style={{ fontSize: 19, margin: "0 0 7px" }}>{p.t}</h3>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{p.b}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* "How it works" and "DHIS2 reporting" both resolve here: the seven-step
          flow ends at step 07, the DHIS2-ready national report. */}
      <section id="how-it-works" style={{ padding: "66px 32px 70px", background: "#0E2A4A" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap", paddingBottom: 18, borderBottom: "1px solid rgba(255,255,255,0.24)" }}>
            <div>
              <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7FC4EA" }}>How it works</span>
              <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: "10px 0 0", color: "#FFFFFF" }}>A patient day, end to end</h2>
            </div>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", maxWidth: 420 }}>Seven steps, one record — from the front desk to the national report.</span>
          </div>
          <div className="tm-flow-rail" style={{ display: "flex", gap: 0, marginTop: 34, overflowX: "auto" }}>
            {PLATFORM_FLOW.map((s) => (
              <div key={s.n} className="tm-flow-step" style={{ flex: "1 0 190px", padding: "0 22px 4px 0", display: "flex", flexDirection: "column", gap: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 11, height: 11, background: "#7FC4EA", flexShrink: 0 }} />
                  <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.28)" }} />
                </div>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15, letterSpacing: "0.1em", color: "#7FC4EA" }}>{s.n}</span>
                <h3 style={{ fontSize: 17.5, margin: 0, lineHeight: 1.25, color: "#FFFFFF" }}>{s.t}</h3>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.72)" }}>{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="offline" style={{ padding: "66px 32px 90px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 26px", paddingBottom: 16, borderBottom: "1px solid var(--color-divider)" }}>Built for power cuts and network gaps</h2>
          <div className="tm-pillars" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {PLATFORM_PILLARS.map((p) => (
              <div key={p.t} className="blueprint" style={{ padding: "24px 26px", background: "var(--color-surface)", display: "flex", flexDirection: "column", gap: 9 }}>
                <Corners />
                <h3 style={{ fontSize: 18, margin: 0 }}>{p.t}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{p.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
