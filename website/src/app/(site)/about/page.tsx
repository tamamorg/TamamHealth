import type { Metadata } from "next";
import Image from "next/image";
import Corners from "@/components/Corners";
import { ADVISORS as ADVISORS_EN, TEAM as TEAM_EN } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "About",
  description:
    "TamamHealth is a nonprofit organization building offline-first digital health records for South Sudan: who we are, what we stand for, our leadership and our team.",
};

export default async function AboutPage() {
  const { t, content } = await getTranslator();
  const TEAM = content(TEAM_EN);
  const ADVISORS = content(ADVISORS_EN);
  return (
    <main>
      {/* Intro band, the same anatomy as the one on /news. */}
      <section style={{ background: "#113055", color: "#FFFFFF", padding: "70px 32px 76px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <h1 style={{ fontSize: "clamp(30px, 4.6vw, 50px)", margin: 0, color: "#FFFFFF" }}>{t("About")}</h1>
          <span style={{ width: 100, height: 3, background: "#7CC7FF" }} />
          <p style={{ margin: 0, maxWidth: 680, fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.84)" }}>
            {t("TamamHealth is a nonprofit organization building offline-first digital health records for South Sudan and sub-Saharan Africa.")}
          </p>
        </div>
      </section>

      {/* Who we are: the nonprofit first, then what the organisation stands
          for, then the facts a funder or partner checks. */}
      <section id="who-we-are" style={{ padding: "76px 32px 84px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 40 }}>
          <div className="tm-split" style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 56, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{t("Who we are")}</span>
              <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>{t("A nonprofit, first")}</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "var(--color-text)" }}>
                {t("TamamHealth is a nonprofit organization. Our purpose is to give health facilities in South Sudan a reliable patient record: one that works without a stable power supply or internet connection, follows the patient from the community health worker to the referral hospital, and supports the national reporting the Ministry of Health relies on.")}
              </p>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "var(--color-text)" }}>
                {t("As a nonprofit, our work is directed by need rather than by revenue. Grants and donations fund the equipment, training and support that each facility needs to adopt the platform.")}
              </p>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 22, margin: "0 0 18px", paddingBottom: 14, borderBottom: "1px solid var(--color-divider)" }}>{t("What we stand for")}</h3>
            <div className="tm-g4" style={{ gap: 22 }}>
              {[
                { k: t("Nonprofit"), v: t("TamamHealth operates as a nonprofit organization, fiscally sponsored by Elimisha Kakuma, a U.S. 501(c)(3) nonprofit.") },
                { k: t("Built for real conditions"), v: t("The platform works offline first, on affordable tablets and solar power, in a health system where 4% of facilities have a computer with internet.") },
                { k: t("Aligned with the health system"), v: t("The platform follows the six levels of care in the Ministry of Health's 2025 Essential Health Services Package and reports through DHIS2.") },
                { k: t("Accountable"), v: t("Every change to a record is audited, and results are reported against the same indicators the Ministry of Health uses.") },
              ].map((c) => (
                <div key={c.k} className="blueprint" style={{ position: "relative", background: "#FFFFFF", padding: "24px 24px 26px", display: "flex", flexDirection: "column", gap: 10, borderTop: "3px solid var(--tm-deep)" }}>
                  <Corners />
                  <h4 style={{ margin: 0, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: "var(--color-text)" }}>{c.k}</h4>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{c.v}</p>
                </div>
              ))}
            </div>
          </div>

          <dl className="tm-explain" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 46px", margin: 0 }}>
            {[
              { k: t("Status"), v: t("Nonprofit organization") },
              { k: t("Fiscal sponsor"), v: t("Elimisha Kakuma, a U.S. 501(c)(3) nonprofit") },
              { k: t("Registration"), v: t("Commonwealth of Massachusetts") },
              { k: t("Origin"), v: t("Founded at Tufts University") },
              { k: t("Focus"), v: t("South Sudan first, then sub-Saharan Africa") },
              { k: t("Current work"), v: t("Platform testing at Iteru Medical Center, Juba") },
            ].map((r) => (
              <div key={r.k} style={{ borderTop: "1px solid var(--color-divider)", padding: "16px 0 18px" }}>
                <dt className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{r.k}</dt>
                <dd style={{ margin: "8px 0 0", fontSize: 15.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>{r.v}</dd>
              </div>
            ))}
          </dl>
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
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>{t("Leadership")}</h2>
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
            <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>{t("Our team")}</h2>
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
