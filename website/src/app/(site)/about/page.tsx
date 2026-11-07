import type { Metadata } from "next";
import Image from "next/image";
import Corners from "@/components/Corners";
import CountUp from "@/components/CountUp";
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
      {/* About hero: a large statement and a mosaic of photographs (the
          product on screen among them) over the blueprint grid, then the
          figures the work is measured by. TamamHealth's own language
          throughout: Barlow Condensed, square frames, corner marks. */}
      <section id="who-we-are" className="tm-about-hero tm-bp-grid" style={{ background: "#113055", color: "#FFFFFF", padding: "72px 32px 76px" }}>
        <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "0.95fr 1.25fr", gap: 56, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 22, alignItems: "flex-start" }}>
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF", fontWeight: 700 }}>{t("About TamamHealth")}</span>
            <h1 className="tm-about-title" style={{ margin: 0, fontWeight: 400, fontSize: "clamp(40px, 5.4vw, 70px)", lineHeight: 1.02, letterSpacing: "-0.01em", color: "#FFFFFF" }}>
              {t("A nonprofit building health records for South Sudan")}
            </h1>
            <p style={{ margin: 0, maxWidth: 480, fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,0.8)" }}>
              {t("We build patient records that work without reliable power or internet, so care in South Sudan continues from one visit to the next.")}
            </p>
            <a href="#values" aria-label={t("Continue to what we stand for")} className="tm-about-down">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
            </a>
          </div>

          <div className="blueprint tm-about-mosaic" style={{ borderColor: "rgba(255,255,255,0.22)" }}>
            <Corners light />
            {[
              { src: "/assets/clinician-with-tablet.jpg", alt: t("A clinician reviewing a patient record on a tablet"), pos: "center 30%", cls: "m1" },
              { src: "/assets/doctor-tablet-review.jpg", alt: t("A doctor reviewing results on a tablet"), pos: "center", cls: "m2" },
              { src: "/assets/platform-patient-chart.png", alt: t("The TamamHealth patient chart"), pos: "left top", cls: "m3" },
              { src: "/assets/community-health-worker.jpg", alt: t("A community health worker with a patient"), pos: "center 35%", cls: "m4" },
            ].map((m) => (
              <div key={m.src} className={`tm-about-tile ${m.cls}`}>
                <Image src={m.src} alt={m.alt} fill sizes="(max-width: 1100px) 50vw, 25vw" preload={m.cls === "m1"} style={{ objectFit: "cover", objectPosition: m.pos }} />
              </div>
            ))}
          </div>
        </div>

        <dl className="tm-about-stats" style={{ maxWidth: 1320, margin: "64px auto 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 28 }}>
          {[
            { to: 6, display: t("6"), label: t("levels of care on one record") },
            { to: 10, display: t("10"), label: t("clinics in the first pilot") },
            { to: 100, prefix: "$", suffix: "K", display: t("$100K"), label: t("pilot funding goal") },
            { to: 1, display: t("1"), label: t("hospital testing the platform today") },
          ].map((st) => (
            <div key={st.label} className="tm-stat">
              <dt style={{ fontFamily: "var(--font-heading)", fontWeight: 400, fontSize: "clamp(44px, 5vw, 72px)", lineHeight: 1, color: "#FFFFFF" }}>
                <CountUp to={st.to} prefix={st.prefix} suffix={st.suffix} display={st.display} />
              </dt>
              <dd style={{ margin: "12px 0 0", fontSize: 15.5, lineHeight: 1.4, color: "rgba(255,255,255,0.78)" }}>{st.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* What we stand for, and the facts a partner checks: one light band. */}
      <section id="values" style={{ padding: "64px 32px 68px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 34 }}>
          <h2 style={{ fontSize: "clamp(24px, 3.2vw, 36px)", margin: 0 }}>{t("What we stand for")}</h2>
          <ul className="tm-g4" style={{ listStyle: "none", margin: 0, padding: 0, gap: 22 }}>
            {[
              { k: t("Nonprofit"), v: t("Funded by grants and donations, guided by need."), d: "M12 21s-7-4.4-9.3-9A5.2 5.2 0 0 1 12 6.6 5.2 5.2 0 0 1 21.3 12C19 16.6 12 21 12 21Z" },
              { k: t("Offline-first"), v: t("Runs on tablets and solar power."), d: "M5 4h14v12H5zM9 20h6M12 16v4" },
              { k: t("Aligned"), v: t("Six levels of care, reported through DHIS2."), d: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5" },
              { k: t("Accountable"), v: t("Every change to a record is audited."), d: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3ZM9 12l2 2 4-4" },
            ].map((c) => (
              <li key={c.k} className="blueprint" style={{ position: "relative", background: "#FFFFFF", padding: "22px 22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                <Corners />
                <span aria-hidden="true" style={{ width: 42, height: 42, display: "grid", placeItems: "center", background: "#113055" }}>
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#7CC7FF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={c.d} /></svg>
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: "var(--color-text)" }}>{c.k}</span>
                <span style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--color-neutral-800)" }}>{c.v}</span>
              </li>
            ))}
          </ul>
          <dl className="tm-about-facts-row" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 28px", margin: 0 }}>
            {[
              { k: t("Fiscal sponsor"), v: t("Elimisha Kakuma, 501(c)(3)") },
              { k: t("Registered"), v: t("Massachusetts") },
              { k: t("Founded"), v: t("Tufts University") },
              { k: t("Now"), v: t("Testing at Iteru Medical Center, Juba") },
            ].map((r) => (
              <div key={r.k} style={{ borderTop: "1px solid var(--color-divider)", padding: "14px 0 4px" }}>
                <dt className="fs115" style={{ letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{r.k}</dt>
                <dd style={{ margin: "6px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--color-text)" }}>{r.v}</dd>
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
      <section id="leadership" style={{ background: "var(--color-surface)", padding: "72px 32px 82px" }}>
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
