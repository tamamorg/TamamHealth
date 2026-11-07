"use client";

/* One news card: cover, category and date, title, a short summary, and a
   "Read more" foot. Used by the home band's four-up strip, the /news explorer
   grid and an article's "More news"; links to the item's article.

   The look lives in globals.css under `.tm-newscard` (hover needs CSS, not
   inline style): a flat blueprint frame whose border and top rule turn blue
   on hover, the cover easing in a few percent, and the arrow stepping right.
   On a phone the card turns into a row with a thumbnail and the summary drops
   out (see the ≤639px block).

   A client component because /news renders it from NewsExplorer, which is
   client-side (it filters as you type). It therefore reads the language from
   the provider rather than the request cookie; the `item` it is handed has
   already been translated by whichever parent supplied it. */

import Link from "next/link";
import Image from "next/image";
import Corners from "@/components/Corners";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { NewsItem } from "@/lib/site-data";

export default function NewsCard({ item }: { item: NewsItem }) {
  const { t } = useLanguage();
  return (
    // alignItems is explicit: the ≤639px `main section a[href]` rule sets
    // align-items: center, which would stop the figure stretching and
    // collapse its aspect-ratio height to zero.
    <Link href={`/news/${item.slug}`} className="blueprint tm-newscard" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "stretch", background: "#FFFFFF", textDecoration: "none" }}>
      <Corners />
      <div className="tm-newscard-fig" style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", overflow: "hidden" }}>
        <Image
          src={item.image}
          alt={item.imageAlt}
          fill
          sizes="(max-width: 639px) 116px, (max-width: 1100px) 50vw, 25vw"
          style={{ objectFit: "cover" }}
        />
      </div>
      <div className="tm-newscard-body" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 22px 0", flex: 1 }}>
        <div className="tm-newscard-meta">
          <span className="tm-newscard-tag">{item.tag}</span>
          <time dateTime={item.dateISO}>{item.date}</time>
        </div>
        <h3 className="tm-newscard-title" style={{ margin: 0, fontSize: 19, lineHeight: 1.3, color: "var(--color-text)" }}>{item.title}</h3>
        <p className="tm-newscard-sum">{item.summary}</p>
        <span className="tm-newscard-more">
          {t("Read more")}
          <span aria-hidden="true" className="tm-newscard-arrow">→</span>
        </span>
      </div>
    </Link>
  );
}
