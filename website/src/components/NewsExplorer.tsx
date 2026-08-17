"use client";

/* /news explorer — the newsroom body: a left rail with the live result count,
   a search box and expandable filter groups (news type, year), and the card
   grid beside it. Pure client-side filtering over the NEWS array. */

import { useMemo, useState } from "react";
import NewsCard from "@/components/NewsCard";
import Corners from "@/components/Corners";
import { NEWS } from "@/lib/site-data";

type GroupKey = "type" | "year";

const count = (list: string[]) => {
  const m = new Map<string, number>();
  for (const v of list) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()];
};

const TYPE_OPTIONS = count(NEWS.map((n) => n.tag));
const YEAR_OPTIONS = count(NEWS.map((n) => n.dateISO.slice(0, 4))).sort((a, b) => b[0].localeCompare(a[0]));

export default function NewsExplorer() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<GroupKey, boolean>>({ type: true, year: false });
  const [types, setTypes] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NEWS.filter((n) => {
      if (types.length && !types.includes(n.tag)) return false;
      if (years.length && !years.includes(n.dateISO.slice(0, 4))) return false;
      if (!q) return true;
      return [n.title, n.summary, n.tag, n.date, ...n.body].join(" ").toLowerCase().includes(q);
    });
  }, [query, types, years]);

  const hasFilters = query.trim() !== "" || types.length > 0 || years.length > 0;

  const group = (key: GroupKey, label: string, options: [string, number][], selected: string[], set: (v: string[]) => void) => (
    <div style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
      <button
        onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
        aria-expanded={open[key]}
        style={{ appearance: "none", background: "none", border: 0, cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "15px 0", textAlign: "left" }}
      >
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, color: "#0E2A4A" }}>{label}</span>
        <span aria-hidden="true" style={{ fontFamily: "var(--font-heading)", fontWeight: 400, fontSize: 24, lineHeight: 1, color: "var(--color-accent-700)" }}>
          {open[key] ? "−" : "+"}
        </span>
      </button>
      {open[key] && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 0 16px" }}>
          {options.map(([value, n]) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 14.5, color: "var(--color-neutral-800)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => toggle(selected, set, value)}
                style={{ width: 16, height: 16, accentColor: "#015697", flexShrink: 0 }}
              />
              <span style={{ flex: 1 }}>{value}</span>
              <span className="fs12" style={{ color: "var(--color-neutral-600)" }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section style={{ padding: "64px 32px 96px", background: "var(--color-surface)" }}>
      <div className="tm-split" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "310px 1fr", gap: 56, alignItems: "start" }}>
        {/* Filter rail */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <h2 style={{ margin: 0, fontSize: 26, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {filtered.length === 1 ? "1 Story" : `${filtered.length} News`}
          </h2>
          <div className="blueprint" style={{ position: "relative", display: "flex", alignItems: "center", background: "#FFFFFF", padding: "2px 10px 2px 16px" }}>
            <Corners />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search news"
              style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "none", fontFamily: "var(--font-body)", fontSize: 15, color: "#0E2A4A", padding: "12px 0" }}
            />
            <span aria-hidden="true" style={{ width: 36, height: 36, display: "grid", placeItems: "center", color: "#015697" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4.5 4.5"></path></svg>
            </span>
          </div>
          <div>
            <span style={{ display: "block", fontSize: 15, color: "var(--color-neutral-700)", paddingBottom: 6 }}>Filter by:</span>
            {group("type", "News type", TYPE_OPTIONS, types, setTypes)}
            {group("year", "Year", YEAR_OPTIONS, years, setYears)}
          </div>
          {hasFilters && (
            <button
              onClick={() => { setQuery(""); setTypes([]); setYears([]); }}
              style={{ appearance: "none", background: "none", border: 0, cursor: "pointer", alignSelf: "flex-start", padding: 0, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15, color: "var(--color-accent-700)" }}
            >
              Clear all filters ✕
            </button>
          )}
        </aside>

        {/* Card grid */}
        {filtered.length > 0 ? (
          <div className="tm-g3" style={{ gap: 22 }}>
            {filtered.map((n) => (
              <NewsCard key={n.slug} item={n} />
            ))}
          </div>
        ) : (
          <div className="blueprint" style={{ position: "relative", background: "#FFFFFF", padding: "46px 40px", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <Corners />
            <h3 style={{ margin: 0, fontSize: 22 }}>Nothing matches that search</h3>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>
              Try a different word, or clear the filters to see every update.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
