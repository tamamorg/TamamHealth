/* Home news band — the four latest updates as cards on the surface ground,
   with a rail heading and an "All news" link into /news. */

import Link from "next/link";
import NewsCard from "@/components/NewsCard";
import { NEWS } from "@/lib/site-data";

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
        <div className="tm-g4" style={{ gap: 22 }}>
          {NEWS.slice(0, 4).map((n) => (
            <NewsCard key={n.slug} item={n} />
          ))}
        </div>
      </div>
    </section>
  );
}
