import { Fragment } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import Corners from "@/components/Corners";
import NewsCard from "@/components/NewsCard";
import CardCarousel from "@/components/CardCarousel";
import { NEWS as NEWS_EN, newsBySlug, type Photo } from "@/lib/site-data";
import { getTranslator } from "@/lib/i18n/server";

/** A photo set into the story. One fills the measure; two run side by side and
    stack on a phone. Captions sit under each frame in the body's own ink. */
function BodyFigure({ photos }: { photos: Photo[] }) {
  const pair = photos.length > 1;
  return (
    <div
      className={pair ? "tm-news-pair" : undefined}
      style={pair ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, margin: "6px 0" } : { margin: "6px 0" }}
    >
      {photos.map((p) => (
        <figure key={p.src} style={{ margin: 0 }}>
          <div style={{ position: "relative", width: "100%", aspectRatio: pair ? "4 / 3" : "3 / 2", overflow: "hidden", border: "1px solid var(--color-divider)" }}>
            <Image
              src={p.src}
              alt={p.alt}
              fill
              sizes={pair ? "(max-width: 760px) 100vw, 650px" : "(max-width: 760px) 100vw, 1320px"}
              style={{ objectFit: "cover" }}
            />
          </div>
          <figcaption className="fs125" style={{ marginTop: 10, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{p.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function generateStaticParams() {
  return NEWS_EN.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const n = newsBySlug(slug);
  if (!n) return {};
  return { title: n.title, description: n.summary };
}

export default async function NewsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { t, content } = await getTranslator();
  const NEWS = content(NEWS_EN);
  const { slug } = await params;
  const i = NEWS.findIndex((x) => x.slug === slug);
  if (i === -1) notFound();
  const n = NEWS[i];
  /* With a single story there is no sibling to walk to — the modulo would
     point prev and next back at this page — so the footer keeps only the
     link back to the newsroom and the "More news" grid drops out entirely. */
  const siblings = NEWS.length > 1;
  const prev = NEWS[(i + NEWS.length - 1) % NEWS.length];
  const next = NEWS[(i + 1) % NEWS.length];
  const more = NEWS.filter((x) => x.slug !== n.slug).slice(0, 3);
  /* The tail strip carries what the story has not already shown — the hero
     frame and every photo set into the body come out of it. */
  const shown = new Set([n.image, ...(n.bodyPhotos ?? []).flatMap((b) => b.photos.map((p) => p.src))]);
  const strip = (n.gallery ?? []).filter((p) => !shown.has(p.src));

  return (
    <main>
      {/* Hero band */}
      <section style={{ background: "#113055", color: "#FFFFFF", padding: "30px 32px 74px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <Link href="/news" style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7CC7FF", textDecoration: "none" }}>{t("← All news")}</Link>
          <div className="tm-split" style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 48, alignItems: "center", marginTop: 26 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "#7CC7FF", fontWeight: 700 }}>{n.tag}</span>
                <time dateTime={n.dateISO} className="fs12" style={{ letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.72)" }}>{n.date}</time>
              </div>
              <h1 style={{ fontSize: "clamp(29px, 4.4vw, 48px)", margin: 0, color: "#FFFFFF" }}>{n.title}</h1>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", maxWidth: 640 }}>{n.summary}</p>
            </div>
            <div className="blueprint tm-figure" style={{ position: "relative", height: 320, borderColor: "rgba(255,255,255,0.28)" }}>
              <Corners light />
              <Image src={n.image} alt={n.imageAlt} fill sizes="(max-width: 760px) 100vw, 44vw" preload style={{ objectFit: "cover" }} />
            </div>
          </div>
        </div>
      </section>

      {/* Body */}
      <section style={{ padding: "66px 32px 24px" }}>
        {/* The story runs the full page grid rather than a narrow reading
            column: 1320 is the width every other section on the site is set
            to, and an 820px column inside it left the article floating in
            white with the header and the photo strip squared off around it. */}
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {n.body.map((para, idx) => (
            <Fragment key={para.slice(0, 32)}>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75, color: "var(--color-text)" }}>{para}</p>
              {n.bodyPhotos
                ?.filter((b) => b.after === idx)
                .map((b) => <BodyFigure key={b.photos[0].src} photos={b.photos} />)}
            </Fragment>
          ))}
          {n.link && (
            <Link href={n.link.href} style={{ marginTop: 6, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18, color: "var(--color-accent-700)", textDecoration: "none" }}>
              {n.link.label} &nbsp;›
            </Link>
          )}
        </div>
      </section>

      {/* Background panel — the competition explained, off to the side of the
          narrative rather than inside it */}
      {n.explainer && (
        <section style={{ padding: "46px 32px 8px" }}>
          <div className="blueprint" style={{ position: "relative", maxWidth: 1320, margin: "0 auto", background: "var(--color-surface)", padding: "44px 46px 40px" }}>
            <Corners />
            <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: 0 }}>{n.explainer.title}</h2>
            <p style={{ margin: "14px 0 0", maxWidth: 720, fontSize: 16, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>{n.explainer.intro}</p>
            <dl className="tm-explain" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 46px", margin: "30px 0 0" }}>
              {n.explainer.rows.map((r) => (
                <div key={r.k} style={{ borderTop: "1px solid var(--color-divider)", padding: "18px 0 20px" }}>
                  <dt className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{r.k}</dt>
                  <dd style={{ margin: "9px 0 0", fontSize: 15, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{r.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {/* Photo strip — scrolls sideways, frames keep their native aspect */}
      {strip.length > 0 && (
        <section style={{ padding: "42px 32px 10px" }}>
          <div style={{ maxWidth: 1320, margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "12px 24px", marginBottom: 24, borderTop: "1px solid var(--color-divider)", paddingTop: 26 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{t("More from the night")}</span>
                {n.galleryTitle && (
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "clamp(20px, 2.6vw, 28px)", lineHeight: 1.15, color: "var(--color-text)" }}>
                    {n.galleryTitle}
                  </span>
                )}
              </div>
              <span className="fs115" style={{ letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)", whiteSpace: "nowrap" }}>
                {t("{{count}} more photos — scroll", { count: strip.length })}
              </span>
            </div>
            <div className="tm-gallery tm-gallery-light" tabIndex={0} role="group" aria-label={`More photos: ${n.title}`}>
              {strip.map((p) => (
                <figure key={p.src}>
                  <Image src={p.src} alt={p.alt} width={p.w} height={p.h} sizes="(max-width: 760px) 82vw, 520px" />
                  <figcaption>{p.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* More news */}
      {more.length > 0 && (
        <section style={{ padding: "50px 32px 20px" }}>
          <div style={{ maxWidth: 1320, margin: "0 auto" }}>
            <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", margin: "0 0 22px", paddingBottom: 16, borderBottom: "1px solid var(--color-divider)" }}>{t("More news")}</h2>
            <CardCarousel className="tm-g3" style={{ gap: 22 }} labels={more.map((x) => x.title)} prevLabel={t("Previous")} nextLabel={t("Next")}>
              {more.map((x) => (
                <NewsCard key={x.slug} item={x} />
              ))}
            </CardCarousel>
          </div>
        </section>
      )}

      {/* Prev / next */}
      <section style={{ padding: "50px 32px 92px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: siblings ? "space-between" : "center", gap: 20, borderTop: "1px solid var(--color-divider)", paddingTop: 26, flexWrap: "wrap" }}>
          {siblings && <Link href={`/news/${prev.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>← {prev.title}</Link>}
          <Link href="/news" style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-600)", textDecoration: "none" }}>{t("All news")}</Link>
          {siblings && <Link href={`/news/${next.slug}`} style={{ fontSize: 15, color: "#015697", textDecoration: "none" }}>{next.title} →</Link>}
        </div>
      </section>
    </main>
  );
}
