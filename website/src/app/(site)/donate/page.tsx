import type { Metadata } from "next";
import Corners from "@/components/Corners";
import DonateWidget from "@/components/DonateWidget";
import { DONATION_FAQ as DONATION_FAQ_EN, DONATION_STEPS as DONATION_STEPS_EN, GOALS as GOALS_EN, SUPPORT_EMAIL } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Goal",
  description:
    "$100,000 puts ten clinics on one record. Every gift buys something physical: a tablet, a solar panel, a trained front desk.",
};

export default async function DonatePage() {
  const { t, content } = await getTranslator();
  const DONATION_FAQ = content(DONATION_FAQ_EN);
  const DONATION_STEPS = content(DONATION_STEPS_EN);
  const GOALS = content(GOALS_EN);
  return (
    <main>
      <section id="donate" style={{ background: "#113055", color: "#FFFFFF", padding: "74px 32px 80px" }}>
        <div className="tm-donate-hero" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 64, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <h1 style={{ fontSize: "clamp(31px, 5.2vw, 56px)", margin: "0 0 16px", color: "#FFFFFF" }}>{t("$100,000 puts ten clinics on one record")}</h1>
            <p style={{ margin: "0 0 auto", maxWidth: 620, fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.82)" }}>
              {t("We’re raising $100,000 to launch TamamHealth in 10 clinics across Juba and greater South Sudan — proof that offline-first digital records can work in the hardest conditions, and the first step toward the same system across sub-Saharan Africa. Every gift buys something physical: a tablet, a solar panel, a trained front desk.")}
            </p>
            <div className="tm-goal-row" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28, paddingTop: 30, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
              {GOALS.map((g) => (
                <div key={g.value} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(26px, 3.8vw, 42px)", lineHeight: 1, color: "#7CC7FF" }}>{g.value}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "rgba(255,255,255,0.78)" }}>{g.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="tm-figure blueprint tm-h420" style={{ position: "relative", height: 420, borderColor: "rgba(255,255,255,0.28)" }}>
            <Corners light />
            {/* eslint-disable-next-line @next/next/no-img-element -- hero figure, sized by CSS */}
            <img src="/assets/images/community-medication-distribution.jpeg" alt={t("A health worker recording medication in a paper register")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      </section>

      {/* Choose an amount */}
      <section style={{ padding: "76px 32px 84px" }}>
        <DonateWidget />
      </section>

      {/* How it works */}
      <section style={{ background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)", padding: "76px 32px 84px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: "0 0 34px" }}>{t("How your donation works")}</h2>
          <div className="tm-g4" style={{ gap: 26 }}>
            {DONATION_STEPS.map((s) => (
              <div key={s.n} style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 18, borderTop: "1px solid var(--color-divider)" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 30, lineHeight: 1, color: s.accent }}>{s.n}</span>
                <h3 style={{ fontSize: 23, margin: 0 }}>{s.title}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "76px 32px 90px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40, flexWrap: "wrap", paddingBottom: 20, borderBottom: "1px solid var(--color-divider)" }}>
            <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0 }}>{t("Questions donors ask")}</h2>
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>
              {t("Anything not answered here — write to")} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {DONATION_FAQ.map((f, k) => (
              <div key={f.q} className="tm-faq-row" style={{ display: "grid", gridTemplateColumns: "44px 1fr 1.5fr", gap: 28, alignItems: "baseline", padding: "26px 0", borderBottom: "1px solid var(--color-divider)" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15, letterSpacing: "0.06em", color: "var(--color-accent)" }}>{String(k + 1).padStart(2, "0")}</span>
                <h3 style={{ fontSize: 20, margin: 0, lineHeight: 1.3 }}>{f.q}</h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
