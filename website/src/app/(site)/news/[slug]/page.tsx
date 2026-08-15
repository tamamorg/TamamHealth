import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Corners from "@/components/Corners";
import NewsCard from "@/components/NewsCard";
import { NEWS, newsBySlug } from "@/lib/site-data";

export function generateStaticParams() {
  return NEWS.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const n = newsBySlug(slug);
  if (!n) return {};
  return { title: n.title, description: n.summary };
}

export default async function NewsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const i = NEWS.findIndex((x) => x.slug === slug);
  if (i === -1) notFound();
  const n = NEWS[i];
  const prev = NEWS[(i + NEWS.length - 1) % NEWS.length];
  const next = NEWS[(i + 1) % NEWS.length];
  const more = NEWS.filter((x) => x.slug !== n.slug).slice(0, 3);

  return (
    <main>
      {/* Hero band */}
      <section style={{ background: "#0E2A4A", color: "#FFFFFF", padding: "30px 32px 74px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <Link href="/news" style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7FC4EA", textDecoration: "none" }}>← All news</Link>
          <div className="tm-split" style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 48, alignItems: "center", marginTop: 26 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7FC4EA", fontWeight: 700 }}>{n.tag}</span>
                <time dateTime={n.dateISO} className="fs12" style={{ letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.72)" }}>{n.date}</time>
              </div>
              <h1 style={{ fontSize: "clamp(29px, 4.4vw, 48px)", margin: 0, color: "#FFFFFF" }}>{n.title}</h1>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", maxWidth: 640 }}>{n.summary}</p>
            </div>
            <div className="blueprint tm-figure" style={{ position: "relative", height: 320, borderColor: "rgba(255,255,255,0.28)" }}>
              <Corners light />
              {/* eslint-disable-next-line @next/next/no-img-element -- hero figure, sized by CSS */}
              <img src={n.image} alt={n.imageAlt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </div>
        </div>
      </section>

      {/* Body */}
      <section style={{ padding: "66px 32px 24px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {n.body.map((para) => (
            <p key={para.slice(0, 32)} style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "var(--color-text)" }}>
              {para}
            </p>
          ))}
          {n.link && (
            <Link href={n.link.href} style={{ marginTop: 6, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18, color: "var(--color-accent-700)", textDecoration: "none" }}>
              {n.link.label} &nbsp;›
            </Link>
          )}
        </div>
      </section>

      {/* More news */}
      <section style={{ padding: "50px 32px 20px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 22px", paddingBottom: 16, borderBottom: "1px solid var(--color-divider)" }}>More news</h2>
          <div className="tm-g3" style={{ gap: 22 }}>
            {more.map((x) => (
              <NewsCard key={x.slug} item={x} />
            ))}
          </div>
        </div>
      </section>

      {/* Prev / next */}
      <section style={{ padding: "20px 32px 92px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, borderTop: "1px solid var(--color-divider)", paddingTop: 26, flexWrap: "wrap" }}>
          <Link href={`/news/${prev.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>← {prev.title}</Link>
          <Link href="/news" style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)", textDecoration: "none" }}>All news</Link>
          <Link href={`/news/${next.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>{next.title} →</Link>
        </div>
      </section>
    </main>
  );
}
