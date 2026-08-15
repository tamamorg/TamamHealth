"use client";

/* ═══ Site chrome: fixed header ═══
   Ported from the design's Nav block. The design ran as a single canvas with
   page state; here navigation is real routes, so "active page" comes from
   usePathname and every onClick-nav becomes a <Link>. Behaviour kept 1:1:
   - 5px accent strip above a white header fixed at top:5px
   - utility row (phone · email · account · language · search) that condenses
     from 38px to 30px once the page scrolls past 70px
   - nav row 76px → 44px condensed, full wordmark → dot mark
   - mega menu per section on hover, closing on header mouse-leave
   - burger drawer ≤1100px; utility row overlays into the bar ≤760px */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Corners from "@/components/Corners";
import { LANGUAGES, PRODUCTS, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/site-data";

type MenuKey = "products" | "platform" | "system" | "about";
type UtilKey = "account" | "lang" | "search" | "drawer";

interface MenuLink {
  label: string;
  note: string;
  href: string;
}

/* Six links. Contact is deliberately not among them: the amber "Get in touch"
   button beside this list is the route to /contact, and listing it twice made
   the row's one call to action compete with a plain link to the same page.
   The About mega menu and the footer still carry it. */
const NAV_ITEMS: { label: string; href: string; menu: MenuKey | null }[] = [
  { label: "Products", href: "/products", menu: "products" },
  { label: "Platform", href: "/platform", menu: "platform" },
  { label: "The health system", href: "/health-system", menu: "system" },
  { label: "About", href: "/about", menu: "about" },
  { label: "News & updates", href: "/news", menu: null },
  { label: "Donate", href: "/donate", menu: null },
];

const MENU_DATA: Record<MenuKey, { title: string; blurb: string; allLabel: string; allHref: string; links: MenuLink[] }> = {
  products: {
    title: "Products",
    blurb: "Six products for every tier of care — hospital, clinic, laboratory, radiology, pharmacy, and the patient's own portal.",
    allLabel: "View all products",
    allHref: "/products",
    links: PRODUCTS.map((p) => ({ label: p.title, note: p.tagline, href: `/products/${p.slug}` })),
  },
  system: {
    title: "The health system",
    blurb: "Six levels of care from the Boma health worker to the teaching hospital — and how Tamam fits the Ministry's own structure rather than replacing it.",
    allLabel: "National alignment",
    allHref: "/health-system",
    links: [
      { label: "Six levels of care", note: "Community, PHCU, PHCC, county, state, referral", href: "/health-system#levels" },
      { label: "National alignment", note: "Shaped around the 2025 EHSP", href: "/health-system" },
      { label: "Deployment footprint", note: "Pilot and planned sites across South Sudan", href: "/#footprint" },
      { label: "DHIS2 reporting", note: "Records that roll up into national reports", href: "/health-system" },
      { label: "The reality we build for", note: "4% have internet, 13% have power", href: "/health-system" },
      { label: "The Ministry's own diagnosis", note: "Parallel, disconnected systems", href: "/health-system" },
    ],
  },
  platform: {
    title: "The platform",
    blurb: "One offline-first record behind every product — simple enough for the front desk, strong enough for the nation.",
    allLabel: "Log in to the platform",
    allHref: "/login",
    links: [
      { label: "How it works", note: "A patient day, end to end", href: "/platform" },
      { label: "Facility dashboard", note: "The day's patients at a glance", href: "/platform" },
      { label: "Offline-first by design", note: "Power cuts, network gaps, role-based access", href: "/platform" },
      { label: "Where care breaks down", note: "The paper problem the platform replaces", href: "/about#crisis" },
      { label: "Staff log in", note: "Clinicians, lab, pharmacy, front desk", href: "/login?role=staff" },
      { label: "Patient portal", note: "Records, prescriptions and results", href: "/login?role=patient" },
      { label: "Get in touch", note: "See it on a real patient day", href: "/contact" },
    ],
  },
  about: {
    title: "About Tamam",
    blurb: "Why Tamam exists, what the data says, and the team building it — founded at Tufts University, starting in South Sudan, built for sub-Saharan Africa.",
    allLabel: "About Tamam",
    allHref: "/about",
    links: [
      { label: "The Problem", note: "Care delivered under impossible conditions", href: "/about#crisis" },
      { label: "The Goal", note: "$100K pilot across 10 clinics", href: "/about#goal" },
      { label: "The Team", note: "Built by people who've lived this", href: "/about#team" },
      { label: "Contact", note: "Get involved", href: "/contact" },
    ],
  },
};

const PORTAL_LINKS = [
  { label: "Staff log in", note: "Clinicians, lab, pharmacy, front desk", href: "/login?role=staff" },
  { label: "Patient portal", note: "Your records, prescriptions and results", href: "/login?role=patient" },
  { label: "Ministry dashboard", note: "National reporting and DHIS2 export", href: "/login?role=ministry" },
];

const SEARCH_SUGGESTIONS = [
  { label: "Offline-first records", href: "/health-system#levels" },
  { label: "HMIS for hospitals", href: "/products" },
  { label: "DHIS2 reporting", href: "/health-system" },
  { label: "Pilot clinics", href: "/#footprint" },
  { label: "News & updates", href: "/news" },
  { label: "Donate", href: "/donate" },
  { label: "Get in touch", href: "/contact" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [condensed, setCondensed] = useState(false);
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const [util, setUtil] = useState<UtilKey | null>(null);
  const [lang, setLang] = useState("English");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 70);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Route change closes every panel — keyed render state, not an effect
  // (the lint-approved shape for "reset state when a prop changes").
  const [panelsFor, setPanelsFor] = useState(pathname);
  if (panelsFor !== pathname) {
    setPanelsFor(pathname);
    setMenu(null);
    setUtil(null);
  }

  const activeHref = useMemo(() => {
    const item = NAV_ITEMS.find(
      (n) => pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href + "/")) ||
        (n.href === "/products" && pathname.startsWith("/products")) ||
        (n.href === "/about" && pathname.startsWith("/challenges")),
    );
    return item?.href ?? null;
  }, [pathname]);

  const toggleUtil = (key: UtilKey) => {
    setMenu(null);
    setUtil((u) => (u === key ? null : key));
  };

  useEffect(() => {
    if (util === "search") searchRef.current?.focus();
  }, [util]);

  const m = menu ? MENU_DATA[menu] : null;
  const utilH = condensed ? 30 : 38;
  const barH = condensed ? 44 : 76;
  const logoH = condensed ? 28 : 30;
  const navPadY = condensed ? 11 : 27;

  const iconBtn = (key: UtilKey): React.CSSProperties => ({
    appearance: "none",
    background: util === key ? "#DDF2FB" : "transparent",
    border: 0,
    cursor: "pointer",
    width: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    color: "#015697",
  });

  return (
    <>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 5, background: "var(--color-accent)", zIndex: 60 }} />
      <header
        onMouseLeave={() => setMenu(null)}
        style={{ position: "fixed", top: 5, left: 0, right: 0, zIndex: 55, background: "#FFFFFF", borderBottom: "1px solid var(--color-divider)" }}
      >
        {/* utility row: contact · account · language · search */}
        <div
          className="tm-util"
          style={{ maxWidth: 1320, margin: "0 auto", padding: "0 32px", height: utilH, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, transition: "height .18s ease" }}
        >
          <div className="tm-util-contact" style={{ marginRight: "auto", display: "flex", alignItems: "center", gap: 20 }}>
            <a href={SUPPORT_PHONE_HREF} className="tm-utilink" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--color-neutral-700)", textDecoration: "none" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              {SUPPORT_PHONE}
            </a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="tm-utilink" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--color-neutral-700)", textDecoration: "none" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16"></rect><path d="m2 6 10 7 10-7"></path></svg>
              {SUPPORT_EMAIL}
            </a>
          </div>

          <div style={{ position: "relative", zIndex: 70 }}>
            <button onClick={() => toggleUtil("account")} aria-label="Log in" title="Log in" aria-expanded={util === "account"} style={iconBtn("account")}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="10" r="3"></circle><path d="M6.7 19a5.3 5.3 0 0 1 10.6 0"></path></svg>
            </button>
            {util === "account" && (
              <div className="blueprint" style={{ position: "absolute", right: 0, top: 40, width: 262, background: "#FFFFFF", boxShadow: "var(--shadow-md)", padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                <Corners />
                <span className="fs11" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>Log in to the portal</span>
                {PORTAL_LINKS.map((p) => (
                  <Link key={p.label} href={p.href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, color: "#0E2A4A" }}>{p.label} &nbsp;›</span>
                    <span className="fs125" style={{ color: "var(--color-neutral-600)" }}>{p.note}</span>
                  </Link>
                ))}
                <span className="fs12" style={{ lineHeight: 1.5, color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
                  Accounts are issued by your facility administrator.
                </span>
              </div>
            )}
          </div>

          <div style={{ position: "relative", zIndex: 70 }}>
            <button onClick={() => toggleUtil("lang")} aria-label="Change language" title="Change language" aria-expanded={util === "lang"} style={iconBtn("lang")}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"></path></svg>
            </button>
            {util === "lang" && (
              <div className="blueprint" style={{ position: "absolute", right: 0, top: 40, width: 228, background: "#FFFFFF", boxShadow: "var(--shadow-md)", padding: "10px 0", display: "flex", flexDirection: "column" }}>
                <Corners />
                {LANGUAGES.map((l) => (
                  <button
                    key={l}
                    onClick={() => { setLang(l); setUtil(null); }}
                    style={{
                      appearance: "none", border: 0, background: "none", cursor: "pointer", textAlign: "left", padding: "9px 20px",
                      fontFamily: "var(--font-body)", fontSize: 14.5,
                      fontWeight: l === lang ? 700 : 400,
                      color: l === lang ? "#015697" : "#0E2A4A",
                      textDecoration: l === lang ? "underline" : "none",
                      textUnderlineOffset: 4,
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => toggleUtil("search")} aria-label="Search" title="Search" aria-expanded={util === "search"} style={iconBtn("search")}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4.5 4.5"></path></svg>
          </button>
        </div>

        {/* nav row */}
        <div className="tm-navrow" style={{ maxWidth: 1320, margin: "0 auto", height: barH, padding: "0 32px", display: "flex", alignItems: "center", gap: 40, transition: "height .18s ease" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
            {/* The full wordmark at every scroll position. The design swaps it
                for the bare dot mark once the header condenses, which reads as
                the brand vanishing mid-scroll — the row still has room for the
                wordmark at 28px, so it keeps its name. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height SVG logo, no optimisation needed */}
            <img
              src="/assets/tamam-logo-full.svg"
              alt="Tamam Healthcare System"
              style={{ height: logoH, width: "auto", transition: "height .18s ease" }}
            />
          </Link>
          <nav className="tm-desktop-nav" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="tm-navlink"
                onMouseEnter={() => setMenu(item.menu)}
                aria-current={activeHref === item.href ? "page" : undefined}
                style={{
                  fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, letterSpacing: "0.01em",
                  color: activeHref === item.href ? "#015697" : "#0E2A4A",
                  textDecoration: "none",
                  padding: `${navPadY}px 14px`,
                  borderBottom: `3px solid ${activeHref === item.href ? "#2191D0" : "transparent"}`,
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </Link>
            ))}
            {/* The rail's one call to action, in the brand accent rather than
                the deep blue the header itself is drawn in. */}
            <Link href="/contact" className="btn blueprint" style={{ marginLeft: 14, padding: "11px 20px", fontSize: 15, color: "#0E2A4A", whiteSpace: "nowrap", background: "#E8863A", borderColor: "#E8863A" }}>
              Get in touch
              <Corners />
            </Link>
          </nav>
          <button className="tm-burger" onClick={() => toggleUtil("drawer")} aria-label="Menu" aria-expanded={util === "drawer"} style={{ appearance: "none", marginLeft: "auto", background: "none", border: "1px solid var(--color-divider)", cursor: "pointer", width: 46, height: 46, placeItems: "center", color: "#015697" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>
          </button>
        </div>

        {/* mega menu */}
        {m && (
          <div style={{ borderTop: "1px solid var(--color-divider)", background: "#FFFFFF", boxShadow: "var(--shadow-md)" }}>
            <div className="tm-inset tm-split" style={{ maxWidth: 1320, margin: "0 auto", padding: "0 32px", display: "grid", gridTemplateColumns: "330px 1fr" }}>
              <div style={{ background: "var(--color-surface)", padding: "40px 36px 44px", display: "flex", flexDirection: "column", gap: 14 }}>
                <h3 style={{ fontSize: 30, margin: 0 }}>{m.title}</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>{m.blurb}</p>
                <Link href={m.allHref} style={{ marginTop: "auto", fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, color: "var(--color-accent-700)", textDecoration: "none" }}>
                  {m.allLabel} &nbsp;›
                </Link>
              </div>
              <div className="tm-g3" style={{ padding: "40px 0 44px 56px", gap: "26px 32px", alignContent: "start" }}>
                {m.links.map((link) => (
                  <Link key={link.label} href={link.href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: "var(--color-text)" }}>{link.label} &nbsp;›</span>
                    <span style={{ fontSize: 13, color: "var(--color-neutral-600)" }}>{link.note}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* mobile drawer */}
        {util === "drawer" && (
          <div style={{ borderTop: "1px solid var(--color-divider)", background: "#FFFFFF", boxShadow: "var(--shadow-md)", display: "flex", flexDirection: "column", padding: "6px 0 18px", maxHeight: "calc(100vh - 130px)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: activeHref === item.href ? "#015697" : "#0E2A4A", textDecoration: "none", padding: "15px 28px", borderBottom: "1px solid var(--color-divider)" }}
              >
                {item.label}
              </Link>
            ))}
            <Link href="/contact" className="btn btn-primary" style={{ margin: "16px 28px 0", padding: "14px 0", fontSize: 16, color: "#0E2A4A" }}>
              Get in touch
            </Link>
          </div>
        )}

        {/* search panel */}
        {util === "search" && (
          <div style={{ borderTop: "1px solid var(--color-divider)", background: "var(--color-surface)", padding: "56px 32px 60px", boxShadow: "var(--shadow-md)" }}>
            <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
              <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0, textAlign: "center" }}>What can we help you with?</h2>
              <div className="blueprint" style={{ width: "100%", display: "flex", alignItems: "center", background: "#FFFFFF", borderWidth: 2, borderColor: "#2191D0", padding: "4px 12px 4px 18px" }}>
                <Corners />
                <input
                  ref={searchRef}
                  placeholder="Search"
                  aria-label="Search the site"
                  style={{ flex: 1, border: 0, outline: "none", background: "none", fontFamily: "var(--font-body)", fontSize: 17, color: "#0E2A4A", padding: "12px 0" }}
                />
                <button aria-label="Run search" style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", width: 40, height: 40, display: "grid", placeItems: "center", color: "#015697" }}>
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4.5 4.5"></path></svg>
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {SEARCH_SUGGESTIONS.map((q) => (
                  <button
                    key={q.label}
                    onClick={() => { setUtil(null); router.push(q.href); }}
                    className="tag tag-accent fs125"
                    style={{ appearance: "none", border: 0, cursor: "pointer", fontFamily: "var(--font-body)", padding: "7px 14px" }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>
      <div className="tm-head-spacer" />
    </>
  );
}
