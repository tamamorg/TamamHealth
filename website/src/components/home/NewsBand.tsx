/* Home news band — a rail heading, an "All news" link into /news, and the
   latest updates below it. With several updates that is the four-up card
   strip; with a single one a card alone in a four-column grid reads as a
   layout fault, so the lead story runs as a full-width feature instead. */

import Link from "next/link";
import Image from "next/image";
import Corners from "@/components/Corners";
import NewsCard from "@/components/NewsCard";
import CardCarousel from "@/components/CardCarousel";
import { getTranslator } from "@/lib/i18n/server";
import { NEWS as NEWS_EN } from "@/lib/site-data";

async function LeadStory() {
  const { t, content } = await getTranslator();
  const n = content(NEWS_EN)[0];
  return (
    <Link
      href={`/news/${n.slug}`}
      className="blueprint tm-split tm-news-lead"
      style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch", background: "#FFFFFF", textDecoration: "none" }}
    >
      <Corners />
      <div className="tm-figure tm-minh280" style={{ position: "relative", minHeight: 340 }}>
        <Image
          src={n.image}
          alt={n.imageAlt}
          fill
          sizes="(max-width: 760px) 100vw, 50vw"
          style={{ objectFit: "cover" }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "44px 46px 46px", borderInlineStart: "1px solid var(--color-divider)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{n.tag}</span>
          <time dateTime={n.dateISO} className="fs12" style={{ letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{n.date}</time>
        </div>
        <h3 style={{ margin: 0, fontSize: "clamp(22px, 2.6vw, 30px)", lineHeight: 1.25, color: "var(--color-text)" }}>{n.title}</h3>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>{n.summary}</p>
        <span style={{ marginTop: "auto", paddingTop: 16, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, color: "var(--color-accent-700)" }}>
          {t("Read more  ›")}
        </span>
      </div>
    </Link>
  );
}

export default async function NewsBand() {
  const { t, content } = await getTranslator();
  // The count that picks the layout reads the English source (it is the same
  // either way); the cards themselves render translated copy.
  const NEWS = content(NEWS_EN);
  return (
    <section id="news" style={{ padding: "84px 32px 90px", background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>{t("News & updates")}</h2>
          <Link href="/news" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, color: "var(--color-accent-700)", textDecoration: "none", whiteSpace: "nowrap" }}>
            {t("All news  ›")}
          </Link>
        </div>
        <div style={{ height: 1, background: "var(--color-divider)", margin: "22px 0 30px" }} />
        {NEWS_EN.length === 1 ? (
          <LeadStory />
        ) : (
          <CardCarousel className="tm-g4" style={{ gap: 22 }} labels={NEWS.slice(0, 4).map((n) => n.title)} prevLabel={t("Previous")} nextLabel={t("Next")}>
            {NEWS.slice(0, 4).map((n) => (
              <NewsCard key={n.slug} item={n} />
            ))}
          </CardCarousel>
        )}
      </div>
    </section>
  );
}
