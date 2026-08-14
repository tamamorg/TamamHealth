import type { Metadata } from "next";
import Corners from "@/components/Corners";
import { GOALS, TEAM } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Tamam exists, what the data says, and the team building it — founded at Tufts University, starting in South Sudan, built for sub-Saharan Africa.",
};

export default function AboutPage() {
  return (
    <main>
      {/* Crisis / origin */}
      <section id="crisis" style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "74px 32px 86px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="tm-origin" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 52 }}>
            <div>
              <h1 style={{ fontSize: "clamp(28px, 4.4vw, 46px)", margin: "0 0 20px", color: "#FFFFFF" }}>How we came to this</h1>
              <p style={{ margin: "0 0 16px", fontSize: 16.5, lineHeight: 1.75, color: "rgba(255,255,255,0.84)" }}>
                We did not start from a market study. We started from waiting rooms we have sat in — as patients, as relatives, and
                alongside clinicians in South Sudan who are asked to practise medicine without a record to practise from. We watched
                a nurse rebuild a child&rsquo;s history by asking the mother to remember it, and a lab result walk across a compound in a
                hand and never arrive.
              </p>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "rgba(255,255,255,0.84)" }}>
                That is the problem we set out to fix, and it is why every design decision starts from the constraint rather than the
                ideal: it has to work on a tablet, on battery, with no signal, run by staff who were trained in a morning. Tamam is
                built by people who know what the paper system costs, because we have watched it cost them.
              </p>
            </div>
            <div className="blueprint tm-award" style={{ borderColor: "rgba(255,255,255,0.28)", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch", alignSelf: "start" }}>
              <Corners light />
              <div style={{ padding: "32px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7FC4EA" }}>Recognition</span>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(34px, 4vw, 48px)", lineHeight: 0.95, color: "#7FC4EA" }}>$10,000</span>
                <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, color: "#FFFFFF" }}>Winner, Healthcare track — Tufts New Ventures Competition</span>
                <p style={{ margin: "6px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "rgba(255,255,255,0.76)" }}>
                  The award funds the first deployments: tablets, solar, and training for the pilot clinics.
                </p>
              </div>
              <div className="tm-figure tm-minh280" style={{ position: "relative", minHeight: 280, borderLeft: "1px solid rgba(255,255,255,0.28)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
                <img src="/assets/community-health-worker.jpg" alt="Placeholder — to be replaced with the team photo from the competition" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Goal */}
      <section id="goal" style={{ background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)", padding: "78px 32px 84px" }}>
        <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>Our goal is to prove it works, then bring it to every clinic that needs it</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>
              We&rsquo;re raising <strong>$100,000</strong>{" "}to launch TamamHealth in 10 clinics across Juba and greater South Sudan — proof
              that offline-first digital records can work in the hardest conditions, and a foundation built to scale across
              sub-Saharan Africa.
            </p>
          </div>
          <div>
            {GOALS.map((g) => (
              <div key={g.value} className="tm-goal-line" style={{ display: "flex", alignItems: "baseline", gap: 24, padding: "22px 0", borderTop: "1px solid var(--color-divider)" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(32px, 4.2vw, 48px)", lineHeight: 1, color: g.accent, minWidth: 150 }}>{g.value}</span>
                <span style={{ fontSize: 15, lineHeight: 1.45 }}>{g.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section id="team" style={{ padding: "80px 32px 90px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 34 }}>
          <div>
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>Built by people who&rsquo;ve lived this</h2>
          </div>
          <div className="tm-g6" style={{ gap: 22 }}>
            {TEAM.map((t) => (
              <div key={t.name} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="blueprint" style={{ position: "relative", width: "100%", paddingTop: "100%", overflow: "hidden", borderBottom: `4px solid ${t.accent}` }}>
                  <Corners />
                  {/* eslint-disable-next-line @next/next/no-img-element -- square portrait, sized by CSS */}
                  <img src={t.image} alt={t.name} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
                </div>
                <div style={{ marginTop: "auto" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19 }}>{t.name}</div>
                  <div className="fs125" style={{ color: "var(--color-neutral-600)" }}>{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
