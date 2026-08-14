import type { Metadata } from "next";
import LevelsExplorer from "@/components/LevelsExplorer";
import ChallengesBand from "@/components/ChallengesBand";
import { ALIGN_FACTS, SYSTEM_STATS } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "The Health System",
  description:
    "Built around South Sudan's own health system — the 2025 Essential Health Services Package's six levels of care, on one offline-first record.",
};

export default function HealthSystemPage() {
  return (
    <main>
      <section style={{ padding: "70px 32px 56px" }}>
        <div className="tm-nat-hero" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 64, alignItems: "end" }}>
          <div>
            <h1 style={{ fontSize: "clamp(31px, 5.2vw, 56px)", margin: "0 0 16px" }}>Built around South Sudan&rsquo;s own health system</h1>
            <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>
              The Ministry of Health&rsquo;s <strong>2025 Essential Health Services Package</strong>{" "}organises the country&rsquo;s care into six
              levels — and names fragmented, paper-bound data as one of its biggest gaps. Tamam is shaped to fit that system, not
              replace it — and the same six-tier structure runs through most sub-Saharan health systems, so what fits here travels.
            </p>
            <span className="tm-rule-sm" style={{ display: "block", width: 300, maxWidth: "60vw", height: 3, background: "var(--color-accent)", marginTop: 26 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {ALIGN_FACTS.map((f) => (
              <div key={f.k} style={{ display: "flex", alignItems: "baseline", gap: 20, padding: "18px 0", borderTop: "1px solid var(--color-divider)" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15, letterSpacing: "0.02em", color: "var(--color-accent)", minWidth: 96 }}>{f.k}</span>
                <span style={{ fontSize: 15, lineHeight: 1.55, color: "var(--color-neutral-800)" }}>{f.v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="levels" style={{ padding: "0 32px 88px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <LevelsExplorer />
        </div>
      </section>

      <section style={{ padding: "78px 32px 84px", background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 28, flexWrap: "wrap", paddingBottom: 20, borderBottom: "1px solid var(--color-divider)" }}>
            <h2 style={{ fontSize: "clamp(25px, 3.6vw, 40px)", margin: 0 }}>The reality Tamam is built for</h2>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>Essential Health Services Package, 2025</span>
          </div>
          <div className="tm-reality-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, marginTop: 0 }}>
            {SYSTEM_STATS.map((s) => (
              <div key={s.value} style={{ padding: "36px 26px 34px", borderRight: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(38px, 5vw, 62px)", lineHeight: 0.95, color: s.accent }}>{s.value}</span>
                <span style={{ fontSize: 15, lineHeight: 1.5 }}>{s.label}</span>
                <span className="fs115" style={{ letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-600)", marginTop: "auto" }}>{s.source}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: "70px 32px 0" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <ChallengesBand />
        </div>
      </section>

      <section style={{ padding: "60px 32px 96px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="tm-pad-lg" style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "46px 52px", display: "flex", flexDirection: "column", gap: 16 }}>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-300)" }}>The Ministry&rsquo;s own diagnosis</span>
            <p style={{ margin: 0, maxWidth: 980, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(23px, 2.6vw, 31px)", lineHeight: 1.3 }}>
              The sector still runs on parallel, disconnected systems — and the lack of accurate, timely data means care and planning
              can&rsquo;t rely on what&rsquo;s recorded.
            </p>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.66)" }}>
              Paraphrased from the South Sudan Essential Health Services Package, 2025 — the exact gap a single offline-first record closes.
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
