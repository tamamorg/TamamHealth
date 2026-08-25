import type { Metadata } from "next";
import Image from "next/image";
import { emphasise } from "@/components/emphasise";
import Link from "next/link";
import { notFound } from "next/navigation";
import Corners from "@/components/Corners";
import { CHALLENGES as CHALLENGES_EN, PRODUCTS as PRODUCTS_EN, challengeBySlug } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

export function generateStaticParams() {
  return CHALLENGES_EN.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = challengeBySlug(slug);
  if (!c) return {};
  return { title: c.title, description: c.short };
}

export default async function ChallengePage({ params }: { params: Promise<{ slug: string }> }) {
  const { t, content } = await getTranslator();
  const CHALLENGES = content(CHALLENGES_EN);
  const PRODUCTS = content(PRODUCTS_EN);
  const { slug } = await params;
  const i = CHALLENGES.findIndex((x) => x.slug === slug);
  if (i === -1) notFound();
  const c = CHALLENGES[i];
  const prev = CHALLENGES[(i + CHALLENGES.length - 1) % CHALLENGES.length];
  const next = CHALLENGES[(i + 1) % CHALLENGES.length];
  const handled = c.products
    .map((ac) => PRODUCTS.find((p) => p.acronym === ac))
    .filter((p): p is (typeof PRODUCTS)[number] => Boolean(p));

  return (
    <main>
      <section style={{ background: "#113055", color: "#FFFFFF", padding: "30px 32px 74px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          {/* Back to the rail these cards came from — it lives on the health
              system page, not on /about. */}
          <Link href="/health-system#challenges" style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7CC7FF", textDecoration: "none" }}>{t("← All challenges")}</Link>
          <div className="tm-split" style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 48, alignItems: "center", marginTop: 26 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
              <h1 style={{ fontSize: "clamp(31px, 5vw, 54px)", margin: 0, color: "#FFFFFF" }}>{c.title}</h1>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", maxWidth: 640 }}>{c.short}</p>
            </div>
            <div className="blueprint tm-figure" style={{ position: "relative", height: 320, borderColor: "rgba(255,255,255,0.28)" }}>
              <Corners light />
              <Image src={c.image} alt={c.imageAlt} fill sizes="(max-width: 760px) 100vw, 44vw" preload style={{ objectFit: "cover" }} />
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: "74px 32px 20px" }}>
        <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 48, alignItems: "start" }}>
          <div>
            <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 18px", paddingBottom: 16, borderBottom: "1px solid var(--color-divider)" }}>{t("What happens today")}</h2>
            <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "var(--color-text)" }}>{c.body}</p>
          </div>
          <div className="blueprint tm-cost" style={{ padding: "26px 28px", background: "var(--color-surface)" }}>
            <Corners />
            <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{t("What it costs")}</span>
            <p style={{ margin: "12px 0 0", fontSize: 16, lineHeight: 1.7 }}>{c.cost}</p>
          </div>
        </div>
      </section>

      <section style={{ padding: "54px 32px 20px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20, paddingBottom: 18, borderBottom: "1px solid var(--color-divider)" }}>
            <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0 }}>{t("What replaces it, step by step")}</h2>
            <span className="fs125" style={{ letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>{t("On the platform")}</span>
          </div>
          <p style={{ margin: "20px 0 0", maxWidth: 780, fontSize: 16, lineHeight: 1.7, color: "var(--color-text)" }}>{emphasise(c.fix)}</p>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
            {c.steps.map((s, k) => (
              <div key={s.t} className="tm-steprow" style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 28, padding: "26px 0", borderBottom: "1px solid var(--color-divider)", alignItems: "start" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 34, lineHeight: 1, color: "#015697" }}>{String(k + 1).padStart(2, "0")}</span>
                <div>
                  <h3 style={{ fontSize: 20, margin: "0 0 8px" }}>{s.t}</h3>
                  <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>{s.b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: "46px 32px 20px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 22px", paddingBottom: 16, borderBottom: "1px solid var(--color-divider)" }}>{t("Where this is handled")}</h2>
          <div className="tm-g3" style={{ gap: 20 }}>
            {handled.map((p) => (
              <Link key={p.slug} href={`/products/${p.slug}`} className="blueprint tm-handled" style={{ padding: "24px 26px", background: "var(--color-surface)", textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 8 }}>
                <Corners />
                <h3 style={{ fontSize: 19, margin: 0 }}>{p.title}</h3>
                <span style={{ marginTop: 6, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#015697" }}>{t("Open product →")}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: "20px 32px 92px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, borderTop: "1px solid var(--color-divider)", paddingTop: 26, flexWrap: "wrap" }}>
          <Link href={`/challenges/${prev.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>← {prev.title}</Link>
          <Link href="/health-system#challenges" style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)", textDecoration: "none" }}>{t("All challenges")}</Link>
          <Link href={`/challenges/${next.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>{next.title} →</Link>
        </div>
      </section>
    </main>
  );
}
