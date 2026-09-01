import type { Metadata } from "next";
import Image from "next/image";
import Corners from "@/components/Corners";
import { emphasise } from "@/components/emphasise";
import { ADVISORS as ADVISORS_EN, TEAM as TEAM_EN } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Tamam exists, what the data says, and the team building it: founded at Tufts University, starting in South Sudan, built for sub-Saharan Africa.",
};

export default async function AboutPage() {
  const { t, content } = await getTranslator();
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
                {t("We did not start from a market study. We started from waiting rooms we have sat in: as patients, as relatives, and alongside clinicians in South Sudan who are asked to practise medicine without a record to practise from. We watched a nurse rebuild a child’s history by asking the mother to remember it, and a lab result walk across a compound in a hand and never arrive.")}
              </p>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "rgba(255,255,255,0.84)" }}>
                {t("That is the problem we set out to fix, and it is why every design decision starts from the constraint rather than the ideal: it has to work on a tablet, on battery, with no signal, run by staff who were trained in a morning. Tamam is built by people who know what the paper system costs, because we have watched it cost them.")}
              </p>
            </div>
            {/* The story's own picture, not the award's.

                This column carried the $10,000 Recognition card and, under it,
                the thirteen-frame competition gallery. Both moved out on
                2026-08-26: the competition has its own article at
                /news/tufts-new-ventures-competition, which is where a prize
                belongs, and repeating it here made the origin story share its
                opening with a trophy. */}
            <div
              className="blueprint tm-figure tm-minh280"
              style={{ position: "relative", minHeight: 340, borderColor: "rgba(255,255,255,0.28)", alignSelf: "start" }}
            >
              <Corners light />
              <Image
                src="/assets/images/pediatric-ward-interior.jpeg"
                alt={t("Mothers waiting beside their children’s cots in a busy paediatric ward, a nurse working the row")}
                fill
                sizes="(max-width: 760px) 100vw, 50vw"
                preload
                style={{ objectFit: "cover" }}
              />
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
                    <Image
                      src={a.image}
                      alt={a.name}
                      fill
                      sizes="(max-width: 520px) 96px, (max-width: 760px) 112px, (max-width: 1100px) 220px, 25vw"
                      style={{ objectFit: "cover", objectPosition: a.focus ?? "center top" }}
                    />
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
                  <Image
                    src={t.image}
                    alt={t.name}
                    fill
                    sizes="(max-width: 479px) 50vw, (max-width: 1100px) 33vw, 17vw"
                    style={{ objectFit: "cover", objectPosition: t.focus ?? "center top" }}
                  />
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
