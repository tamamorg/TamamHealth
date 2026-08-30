import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Corners from "@/components/Corners";
import CardCarousel from "@/components/CardCarousel";
import { emphasise } from "@/components/emphasise";
import { CHALLENGES as CHALLENGES_EN, PLATFORM_FACTS as PLATFORM_FACTS_EN, PLATFORM_FLOW as PLATFORM_FLOW_EN, PLATFORM_PILLARS as PLATFORM_PILLARS_EN } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "The Platform",
  description:
    "How TamamHealth solves it: each failure paper records create in South Sudan's facilities, and what the offline-first platform does about it — from the front desk to the Ministry.",
};

export default async function PlatformPage() {
  const { t, content } = await getTranslator();
  const CHALLENGES = content(CHALLENGES_EN);
  const PLATFORM_FACTS = content(PLATFORM_FACTS_EN);
  const PLATFORM_FLOW = content(PLATFORM_FLOW_EN);
  const PLATFORM_PILLARS = content(PLATFORM_PILLARS_EN);
  return (
    <main>
      <section style={{ background: "#015697", color: "#FFFFFF", padding: "60px 32px 74px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="tm-platform-split" style={{ display: "grid", gridTemplateColumns: "1fr 1.05fr", gap: 52, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }}>
              <h1 style={{ fontSize: "clamp(31px, 5vw, 54px)", margin: 0, color: "#FFFFFF" }}>{t("One record, from the front desk to the Ministry")}</h1>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", maxWidth: 660 }}>
                {t("Simple enough for the front desk. Strong enough for the nation. Everything the paper system loses — history, time, trust — Tamam keeps. One offline-first record that follows the patient through every visit.")}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", marginTop: 6 }}>
                <Link href="/contact" className="btn blueprint" style={{ padding: "14px 28px", fontSize: 15.5, background: "#FFFFFF", borderColor: "#FFFFFF", color: "#015697" }}>
                  {t("Get in touch")}
                  <Corners />
                </Link>
                <Link href="/products" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, color: "#7CC7FF", textDecoration: "none" }}>
                  {t("See the six products →")}
                </Link>
              </div>
            </div>
            {/* The platform itself, opposite the claim about it — the patient
                record, which is the one record the sentence to the left is
                about. The front desk is the hero on /products, so the two
                pages show different rooms rather than the same screenshot
                twice. */}
            <figure className="blueprint tm-figure" style={{ margin: 0, position: "relative", background: "#FFFFFF", padding: 8, borderColor: "rgba(255,255,255,0.28)" }}>
              <Corners light />
              <Image
                src="/assets/platform-patient-chart.png"
                alt={t("A TamamHealth patient record: allergies and current vitals across the top, with medications, safety alerts, latest observations and next care actions below")}
                width={3200}
                height={1928}
                sizes="(max-width: 760px) 100vw, 52vw"
                preload
                style={{ width: "100%", height: "auto" }}
              />
              {/* The frame says what room it is: without a line under it a
                  screenshot is decoration, and a reader who has never seen the
                  product cannot tell a chart from a queue. */}
              <figcaption className="fs125" style={{ padding: "9px 5px 2px", lineHeight: 1.5, color: "var(--color-neutral-600)" }}>
                {t("The patient record — allergies, vitals, medications and the next care actions, in one view.")}
              </figcaption>
            </figure>
          </div>
          {/* The three facts move out of the right column and under both, as a
              row: stacked beside the copy they competed with the headline for
              the same eye, and the column they sat in is where the product
              belongs. */}
          <div className="tm-g3 tm-platform-facts" style={{ gap: 14, marginTop: 42 }}>
            {PLATFORM_FACTS.map((f) => (
              <div key={f.value} className="blueprint tm-fact" style={{ padding: "20px 24px", borderColor: "rgba(255,255,255,0.28)" }}>
                <Corners light />
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 30, lineHeight: 1, color: "#7CC7FF" }}>{f.value}</span>
                <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>{f.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The answer, failure by failure. "Our Solution" on the home hero lands
          at the top of this page and reads down into this section —
          the same eight failures the challenge cards document, each paired with
          what the platform actually does about it. Both halves come from
          CHALLENGES, so the fix stated here and the fix on the challenge page
          can never drift apart. */}
      <section id="solution" style={{ padding: "74px 32px 20px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 22, borderBottom: "1px solid var(--color-divider)" }}>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{t("Our solution")}</span>
            <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0 }}>{t("Eight ways paper fails, and what the platform does instead")}</h2>
            <p style={{ margin: 0, maxWidth: 760, fontSize: 16, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>
              {t("Every one of these was documented inside South Sudanese facilities before a line of the platform was written. None of them is solved by digitising a form — each needed a specific mechanism, and each mechanism works with the power off and the network down.")}
            </p>
          </div>

          {/* Two-up, and each card is one failure and its answer — nothing
              else. The one-line restatement and the cost line both live on the
              challenge page this card opens; repeating them here tripled the
              height of the section for facts the reader gets on the next
              click. The section heading already says which half is which, so
              the cards carry no "problem"/"solution" labels either. */}
          <CardCarousel className="tm-split tm-solution-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 26 }} labels={CHALLENGES.map((c) => c.title)} prevLabel={t("Previous")} nextLabel={t("Next")}>
            {CHALLENGES.map((c) => (
              <Link
                key={c.slug}
                href={`/challenges/${c.slug}`}
                className="blueprint tm-solution-card"
                style={{
                  position: "relative",
                  background: "var(--color-surface)",
                  padding: "20px 22px 18px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 10,
                  textDecoration: "none",
                }}
              >
                <Corners />
                <h3 style={{ fontSize: 18, margin: 0, lineHeight: 1.3, color: "var(--color-text)" }}>{c.title}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{emphasise(c.fix)}</p>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: "auto", paddingTop: 6 }}>
                  <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {c.products.map((acronym) => (
                      <span
                        key={acronym}
                        className="fs11"
                        style={{ border: "1px solid var(--color-divider)", padding: "2px 6px", letterSpacing: "0.06em", color: "var(--color-neutral-700)" }}
                      >
                        {acronym}
                      </span>
                    ))}
                  </span>
                  <span className="fs125" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>
                    {t("How it works  ›")}
                  </span>
                </span>
              </Link>
            ))}
          </CardCarousel>
        </div>
      </section>

      {/* "How it works" and "DHIS2 reporting" both resolve here: the seven-step
          flow ends at step 07, the DHIS2-ready national report. */}
      <section id="how-it-works" style={{ padding: "66px 32px 70px", background: "#113055" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap", paddingBottom: 18, borderBottom: "1px solid rgba(255,255,255,0.24)" }}>
            <div>
              <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF" }}>{t("How it works")}</span>
              <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: "10px 0 0", color: "#FFFFFF" }}>{t("A patient day, end to end")}</h2>
            </div>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", maxWidth: 420 }}>{t("Seven steps, one record — from the front desk to the national report.")}</span>
          </div>
          {/* The seven steps divide the container rather than sitting on a fixed
              190px basis: seven of those came to 1330px inside a 1320px row, so
              the whole flow scrolled sideways by ten pixels for no reason. They
              still fall back to a scrolling rail under 1100px, where seven
              columns genuinely do not fit. */}
          <div className="tm-flow-rail" style={{ display: "flex", gap: 0, marginTop: 34, overflowX: "auto" }}>
            {PLATFORM_FLOW.map((s) => (
              <div key={s.n} className="tm-flow-step" style={{ flex: "1 1 0", minWidth: 0, padding: "0 22px 4px 0", display: "flex", flexDirection: "column", gap: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 11, height: 11, background: "#7CC7FF", flexShrink: 0 }} />
                  <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.28)" }} />
                </div>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15, letterSpacing: "0.1em", color: "#7CC7FF" }}>{s.n}</span>
                <h3 style={{ fontSize: 17.5, margin: 0, lineHeight: 1.25, color: "#FFFFFF" }}>{s.t}</h3>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.72)" }}>{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="offline" style={{ padding: "66px 32px 90px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 26px", paddingBottom: 16, borderBottom: "1px solid var(--color-divider)" }}>{t("Built for power cuts and network gaps")}</h2>
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
