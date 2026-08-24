import type { Metadata } from "next";
import Corners from "@/components/Corners";
import { emphasise } from "@/components/emphasise";
import { ADVISORS as ADVISORS_EN, DERBY_PHOTOS as DERBY_PHOTOS_EN, TEAM as TEAM_EN } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Tamam exists, what the data says, and the team building it — founded at Tufts University, starting in South Sudan, built for sub-Saharan Africa.",
};

export default async function AboutPage() {
  const { t, content } = await getTranslator();
  const DERBY_PHOTOS = content(DERBY_PHOTOS_EN);
  const TEAM = content(TEAM_EN);
  const ADVISORS = content(ADVISORS_EN);
  return (
    <main>
      {/* Crisis / origin */}
      <section id="crisis" style={{ background: "#113055", color: "#FFFFFF", padding: "74px 32px 86px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div className="tm-origin" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 52 }}>
            <div>
              <h1 style={{ fontSize: "clamp(28px, 4.4vw, 46px)", margin: "0 0 20px", color: "#FFFFFF" }}>{t("Our story & Purpose")}</h1>
              <p style={{ margin: "0 0 16px", fontSize: 16.5, lineHeight: 1.75, color: "rgba(255,255,255,0.84)" }}>
                {t("We did not start from a market study. We started from waiting rooms we have sat in — as patients, as relatives, and alongside clinicians in South Sudan who are asked to practise medicine without a record to practise from. We watched a nurse rebuild a child’s history by asking the mother to remember it, and a lab result walk across a compound in a hand and never arrive.")}
              </p>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "rgba(255,255,255,0.84)" }}>
                {t("That is the problem we set out to fix, and it is why every design decision starts from the constraint rather than the ideal: it has to work on a tablet, on battery, with no signal, run by staff who were trained in a morning. Tamam is built by people who know what the paper system costs, because we have watched it cost them.")}
              </p>
            </div>
            <div className="blueprint tm-award" style={{ borderColor: "rgba(255,255,255,0.28)", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch", alignSelf: "start" }}>
              <Corners light />
              <div style={{ padding: "32px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF" }}>{t("Recognition")}</span>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(34px, 4vw, 48px)", lineHeight: 0.95, color: "#7CC7FF" }}>$10,000</span>
                <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, color: "#FFFFFF" }}>{t("Second place, Healthcare & Life Science track — Tufts New Ventures Competition")}</span>
                <p style={{ margin: "6px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "rgba(255,255,255,0.76)" }}>
                  {t("Our first venture competition — judged on a working platform, not a slide deck: a full patient day on screen with the network switched off.")}
                </p>
                <span className="fs115" style={{ marginTop: "auto", paddingTop: 14, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
                  {t("Derby Entrepreneurship Center at Tufts · April 10, 2026")}
                </span>
              </div>
              <div className="tm-figure tm-minh280" style={{ position: "relative", minHeight: 280, borderInlineStart: "1px solid rgba(255,255,255,0.28)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
                <img src="/assets/derby/derby-05.jpg" alt={t("Toye Adebayo, Teny Makuach and Ekow Williams holding the $10,000 check at the Derby Entrepreneurship Center at Tufts")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            </div>
          </div>

          {/* Competition gallery */}
          <div style={{ marginTop: 64, borderTop: "1px solid rgba(255,255,255,0.28)", paddingTop: 26 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "12px 24px", marginBottom: 26 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF" }}>{t("From the competition")}</span>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(20px, 2.6vw, 28px)", lineHeight: 1.15, color: "#FFFFFF" }}>
                  {t("April 10, 2026 — the night the pilot got its first funding")}
                </span>
              </div>
              <span className="fs115" style={{ letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>
                {t("13 photos — scroll")}
              </span>
            </div>
            <div className="tm-gallery" tabIndex={0} role="group" aria-label={t("Photos from the Tufts New Ventures Competition, April 10, 2026")}>
              {DERBY_PHOTOS.map((p, i) => (
                <figure key={p.src}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- gallery frame, sized by CSS */}
                  <img src={p.src} alt={p.alt} loading={i < 2 ? undefined : "lazy"} />
                  <figcaption>{p.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Leadership — the advisors, above the team they advise.

          The card is the team tile's anatomy at advisor scale: a big portrait
          plate, then a footer that answers what they do, where, and in what
          field. No paragraph — three facts read faster than a bio, and the
          portrait is doing the introducing. */}
      <section id="leadership" style={{ background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)", padding: "72px 32px 82px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>{t("Our Leadership")}</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>{t("Advisors to TamamHealth.")}</p>
          </div>
          <div className="tm-lead-grid">
            {ADVISORS.map((a) => (
              <article key={a.name} className="blueprint tm-lead-card" style={{ background: "var(--color-bg)", borderBottom: `4px solid ${a.accent}` }}>
                <Corners />
                <div className="tm-lead-plate">
                  {a.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- portrait plate, sized by CSS */
                    <img src={a.image} alt={a.name} style={{ objectPosition: a.focus ?? "center top" }} />
                  ) : (
                    /* No portrait sent yet — a monogram holds the plate rather
                       than a broken image or a stock silhouette. */
                    <span className="tm-lead-mono" aria-hidden="true">{initials(a.name)}</span>
                  )}
                </div>
                <div className="tm-lead-body">
                  <h3 className="tm-lead-name">{a.name}</h3>
                  <p className="tm-lead-role">{a.role}</p>
                  {/* Where they sit and the field they sit in — the two facts a
                      reader scans before reading the title above them. */}
                  <p className="tm-lead-where fs125">{a.institutions.join(" · ")}</p>
                  <div className="tm-lead-tags">
                    <span className="tag" style={{ color: a.accent, background: "rgba(1,86,151,0.11)" }}>{a.industry}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section id="team" style={{ padding: "80px 32px 90px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 34 }}>
          <div>
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>{t("Built by people who’ve lived this")}</h2>
          </div>
          <div className="tm-g6" style={{ gap: 22 }}>
            {TEAM.map((t) => (
              <div key={t.name} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="blueprint" style={{ position: "relative", width: "100%", paddingTop: "100%", overflow: "hidden", borderBottom: `4px solid ${t.accent}` }}>
                  <Corners />
                  {/* eslint-disable-next-line @next/next/no-img-element -- square portrait, sized by CSS */}
                  <img src={t.image} alt={t.name} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: t.focus ?? "center top" }} />
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

/** "David Blair" -> "DB". Two letters, so the monogram sits at one size. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
