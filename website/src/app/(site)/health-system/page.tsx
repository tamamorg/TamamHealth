import type { Metadata } from "next";
import LevelsExplorer from "@/components/LevelsExplorer";
import ChallengesBand from "@/components/ChallengesBand";
import { ALIGN_FACTS as ALIGN_FACTS_EN, TOOLING_STATS as TOOLING_STATS_EN, PROBLEM_LEAD as PROBLEM_LEAD_EN, PROBLEM_BREAKS as PROBLEM_BREAKS_EN, PROBLEM_WHY_TITLE as PROBLEM_WHY_TITLE_EN, PROBLEM_WHY as PROBLEM_WHY_EN } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "The Health System",
  description:
    "South Sudan's healthcare system — the 2025 Essential Health Services Package's six levels of care, on one offline-first record.",
};

export default async function HealthSystemPage() {
  const { t, content } = await getTranslator();
  const ALIGN_FACTS = content(ALIGN_FACTS_EN);
  const TOOLING_STATS = content(TOOLING_STATS_EN);
  const PROBLEM_LEAD = content(PROBLEM_LEAD_EN);
  const PROBLEM_BREAKS = content(PROBLEM_BREAKS_EN);
  const PROBLEM_WHY_TITLE = content(PROBLEM_WHY_TITLE_EN);
  const PROBLEM_WHY = content(PROBLEM_WHY_EN);
  return (
    <main>
      <section style={{ padding: "70px 32px 46px" }}>
        <div className="tm-nat-hero" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 64, alignItems: "end" }}>
          <div>
            <h1 style={{ fontSize: "clamp(31px, 5.2vw, 56px)", margin: "0 0 16px" }}>{t("South Sudan’s healthcare system")}</h1>
            <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>
              {t("The Ministry of Health’s")} <strong>{t("2025 Essential Health Services Package")}</strong>{" "}organises the country&rsquo;s care into six
              levels — and names fragmented, paper-bound data as one of its biggest gaps. Tamam is shaped to fit that system, not
              replace it — and the same six-tier structure runs through most sub-Saharan health systems, so what fits here travels.
            </p>
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

      <section id="levels" style={{ padding: "44px 32px 78px", background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <LevelsExplorer />
        </div>
      </section>

      <section id="reality" style={{ padding: "78px 32px 84px", background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 28, flexWrap: "wrap", paddingBottom: 20, borderBottom: "1px solid var(--color-divider)" }}>
            <h2 style={{ fontSize: "clamp(25px, 3.6vw, 40px)", margin: 0 }}>{t("The reality Tamam is built for")}</h2>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{t("Essential Health Services Package, 2025")}</span>
          </div>

          {/* The problem, argued — the strip's "The Problem" card lands here.
              Every figure sits inside the break it evidences rather than in a
              statistics strip of its own, so the numbers are read as part of
              the argument and not as decoration under it. */}
          <p style={{ maxWidth: "70ch", margin: "32px 0 0", fontSize: 18, lineHeight: 1.72, color: "var(--color-neutral-900)" }}>
            {PROBLEM_LEAD}
          </p>
          <div className="tm-problem-breaks" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, margin: "40px 0 0" }}>
            {PROBLEM_BREAKS.map((b) => (
              <article key={b.where} className="blueprint" style={{ background: "#FFFFFF", display: "flex", flexDirection: "column" }}>
                {/* The place the break happens labels the photograph, so the
                    panel opens on the scene, then the figure, then the claim. */}
                <div className="tm-figure tm-break-fig" style={{ position: "relative", height: 172, borderBottom: "3px solid var(--color-accent)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- panel figure, sized by CSS */}
                  <img src={b.image} alt={b.imageAlt} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: b.focus }} />
                  <span className="fs115" style={{ position: "absolute", left: 0, bottom: 0, background: "var(--color-accent-300)", color: "#0E2A4A", padding: "7px 12px 6px", letterSpacing: "0.13em", textTransform: "uppercase", fontWeight: 700 }}>{b.where}</span>
                </div>
                {/* Recessed data plate. The fixed minimum keeps the three
                    numerals — and the headings under them — on one line
                    across the row however the unit and note wrap. */}
                <div className="tm-problem-plate" style={{ background: "var(--color-surface)", padding: "18px 22px 16px", minHeight: 118, display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 11, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(34px, 3.4vw, 44px)", lineHeight: 0.92, color: "var(--color-accent-700)" }}>{b.stat.value}</span>
                    <span style={{ fontSize: 14.5, lineHeight: 1.4, fontWeight: 500 }}>{b.stat.unit}</span>
                  </div>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--color-neutral-700)" }}>{b.stat.note}</span>
                  <span className="fs115" style={{ marginTop: "auto", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{b.stat.source}</span>
                </div>
                <div style={{ padding: "20px 22px 24px", display: "flex", flexDirection: "column", gap: 9 }}>
                  <h3 style={{ fontSize: 22, lineHeight: 1.18, margin: 0 }}>{b.what}</h3>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.68, color: "var(--color-neutral-800)" }}>{b.body}</p>
                </div>
              </article>
            ))}
          </div>

          {/* The conclusion the three breaks add up to, with the two
              infrastructure figures that make offline-first a requirement
              standing beside it rather than in a row of their own. */}
          <div className="blueprint tm-problem-close" style={{ background: "#FFFFFF", borderTop: "2px solid var(--color-accent)", marginTop: 24, display: "grid", gridTemplateColumns: "1.55fr 1fr" }}>
            <div style={{ padding: "30px 30px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ fontSize: "clamp(21px, 2.2vw, 27px)", lineHeight: 1.24, margin: 0, maxWidth: "26ch" }}>{PROBLEM_WHY_TITLE}</h3>
              <p style={{ margin: 0, maxWidth: "60ch", fontSize: 16, lineHeight: 1.72, color: "var(--color-neutral-800)" }}>{PROBLEM_WHY}</p>
            </div>
            <div className="tm-problem-figs" style={{ borderInlineStart: "1px solid var(--color-divider)", display: "flex", flexDirection: "column" }}>
              {TOOLING_STATS.map((s, i) => (
                <div key={s.value} style={{ flex: 1, padding: "24px 26px", display: "flex", alignItems: "baseline", gap: 14, borderTop: i === 0 ? "none" : "1px solid var(--color-divider)" }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(34px, 3.4vw, 44px)", lineHeight: 0.92, color: "var(--color-accent-700)", minWidth: 72 }}>{s.value}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 14.5, lineHeight: 1.45 }}>{s.label}</span>
                    <span className="fs115" style={{ letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{s.source}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The only place the eight challenge cards live — every "all challenges"
          and "where care breaks down" link in the site resolves to this id. */}
      <section id="challenges" style={{ padding: "70px 32px 0" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <ChallengesBand />
        </div>
      </section>

      <section id="diagnosis" style={{ padding: "60px 32px 96px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="tm-pad-lg" style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "46px 52px", display: "flex", flexDirection: "column", gap: 16 }}>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-300)" }}>{t("The Ministry’s own diagnosis")}</span>
            <p style={{ margin: 0, maxWidth: 980, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(23px, 2.6vw, 31px)", lineHeight: 1.3 }}>
              {t("The sector still runs on parallel, disconnected systems — and the lack of accurate, timely data means care and planning can’t rely on what’s recorded.")}
            </p>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.66)" }}>
              {t("Paraphrased from the South Sudan Essential Health Services Package, 2025 — the exact gap a single offline-first record closes.")}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
