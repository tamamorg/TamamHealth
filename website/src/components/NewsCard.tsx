/* One news card — image, date, title, "Read more". Used by the home band's
   four-up strip and the /news explorer grid; links to the item's article. */

import Link from "next/link";
import Corners from "@/components/Corners";
import type { NewsItem } from "@/lib/site-data";

export default function NewsCard({ item }: { item: NewsItem }) {
  return (
    // alignItems is explicit: the ≤639px `main section a[href]` rule sets
    // align-items: center, which would stop the figure stretching and
    // collapse its aspect-ratio height to zero.
    <Link href={`/news/${item.slug}`} className="blueprint" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "stretch", background: "#FFFFFF", textDecoration: "none" }}>
      <Corners />
      <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- card figure, sized by CSS */}
        <img src={item.image} alt={item.imageAlt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 22px 24px", flex: 1 }}>
        <time dateTime={item.dateISO} className="fs12" style={{ letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>
          {item.date}
        </time>
        <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.35, color: "var(--color-text)" }}>{item.title}</h3>
        <span style={{ marginTop: "auto", paddingTop: 10, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, color: "var(--color-accent-700)" }}>
          Read more &nbsp;›
        </span>
      </div>
    </Link>
  );
}
