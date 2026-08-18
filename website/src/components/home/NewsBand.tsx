/* Home news band — a rail heading, an "All news" link into /news, and the
   latest updates below it. With several updates that is the four-up card
   strip; with a single one a card alone in a four-column grid reads as a
   layout fault, so the lead story runs as a full-width feature instead. */

import Link from "next/link";
import Corners from "@/components/Corners";
import NewsCard from "@/components/NewsCard";
import { NEWS } from "@/lib/site-data";

function LeadStory() {
  const n = NEWS[0];
  return (
    <Link
      href={`/news/${n.slug}`}
      className="blueprint tm-split tm-news-lead"
      style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch", background: "#FFFFFF", textDecoration: "none" }}
    >
      <Corners />
      <div className="tm-figure tm-minh280" style={{ position: "relative", minHeight: 340 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
        <img src={n.image} alt={n.imageAlt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "44px 46px 46px", borderLeft: "1px solid var(--color-divider)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="fs115" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent-700)", fontWeight: 700 }}>{n.tag}</span>
          <time dateTime={n.dateISO} className="fs12" style={{ letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{n.date}</time>
        </div>
        <h3 style={{ margin: 0, fontSize: "clamp(22px, 2.6vw, 30px)", lineHeight: 1.25, color: "var(--color-text)" }}>{n.title}</h3>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>{n.summary}</p>
        <span style={{ marginTop: "auto", paddingTop: 16, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, color: "var(--color-accent-700)" }}>
          Read more &nbsp;›
        </span>
      </div>
    </Link>
  );
}

export default function NewsBand() {
  return (
    <section id="news" style={{ padding: "84px 32px 90px", background: "var(--color-surface)", borderTop: "1px solid var(--color-divider)" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: "clamp(26px, 3.8vw, 42px)", margin: 0 }}>News &amp; updates</h2>
          <Link href="/news" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, color: "var(--color-accent-700)", textDecoration: "none", whiteSpace: "nowrap" }}>
            All news &nbsp;›
          </Link>
        </div>
        <div style={{ height: 1, background: "var(--color-divider)", margin: "22px 0 30px" }} />
        {NEWS.length === 1 ? (
          <LeadStory />
        ) : (
          <div className="tm-g4" style={{ gap: 22 }}>
            {NEWS.slice(0, 4).map((n) => (
              <NewsCard key={n.slug} item={n} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
