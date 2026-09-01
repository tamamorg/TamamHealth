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
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Corners from "@/components/Corners";
import {
  MENU_DATA as MENU_DATA_EN,
  NAV_ITEMS as NAV_ITEMS_EN,
  PORTAL_LINKS as PORTAL_LINKS_EN,
  SEARCH_SUGGESTIONS as SEARCH_SUGGESTIONS_EN,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
} from "@/lib/site-data";
import type { MenuKey } from "@/lib/site-data";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { searchSite, type SearchHit } from "@/lib/site-search";
import HashLink from "@/components/HashLink";
import { hashTargetOnPage, scrollToHash } from "@/lib/hash-nav";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type UtilKey = "account" | "lang" | "search" | "drawer";


export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [condensed, setCondensed] = useState(false);
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const [util, setUtil] = useState<UtilKey | null>(null);
  const { locale, setLocale, t, content } = useLanguage();
  // The header's own copy — nav labels, mega-menu blurbs, the portal list and
  // the search suggestions — lives in site-data so one extractor sees every
  // translatable string on the site. Translated here, per request language.
  const NAV_ITEMS = content(NAV_ITEMS_EN);
  const MENU_DATA = content(MENU_DATA_EN);
  const PORTAL_LINKS = content(PORTAL_LINKS_EN);
  const SEARCH_SUGGESTIONS = content(SEARCH_SUGGESTIONS_EN);
  const searchRef = useRef<HTMLInputElement>(null);
  // Search panel: what has been typed, and which result the keyboard is on.
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

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

  /* Detail routes highlight the section they belong to: /products/[slug] and
     /news/[slug] sit under their own nav item, and /challenges/[slug] under
     "The health system" — that page carries the challenge rail. */
  const activeHref = useMemo(() => {
    // Matched against the English source: this compares hrefs, which are never
    // translated, so it must not re-run every time the language changes.
    const item = NAV_ITEMS_EN.find(
      (n) => pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href + "/")) ||
        (n.href === "/health-system" && pathname.startsWith("/challenges")),
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

  // Closing the panel empties it — reopening it should offer the suggestions
  // again, not last week's half-typed word. Keyed render state rather than an
  // effect, the same shape the panel reset above uses.
  const [searchFor, setSearchFor] = useState(util);
  if (searchFor !== util) {
    setSearchFor(util);
    if (util !== "search") { setQuery(""); setCursor(0); }
  }

  /* Results for what is typed, in the language being read. Empty until the
     query means something (see searchSite), which is what keeps the
     suggestions on screen while the field is still empty. */
  const hits = useMemo(() => searchSite(query, t), [query, t]);
  // Clamp rather than reset on every keystroke: the cursor is only ever asked
  // for a row that exists.
  const active = hits.length ? Math.min(cursor, hits.length - 1) : 0;

  /** Opens a result — or scrolls to it, when it is a section of this page.
      Going through the router there would be a no-op (see lib/hash-nav), which
      is what made a second click on the same result do nothing. */
  const goTo = (href: string, external = false) => {
    setUtil(null);
    setQuery("");
    setCursor(0);
    if (external) { window.location.assign(href); return; }
    const hash = hashTargetOnPage(href, pathname);
    if (hash && scrollToHash(hash)) return;
    router.push(href);
  };

  const openHit = (hit: SearchHit) => goTo(hit.href, hit.external);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Escape") {
      // First Escape clears a query, a second closes the panel — the same
      // two-step every search field in the platform uses.
      if (query) { setQuery(""); setCursor(0); } else setUtil(null);
    }
  };

  const m = menu ? MENU_DATA[menu] : null;
  const utilH = condensed ? 30 : 38;
  const barH = condensed ? 44 : 76;
  const logoH = condensed ? 28 : 30;
  const navPadY = condensed ? 11 : 27;

  const iconBtn = (key: UtilKey): React.CSSProperties => ({
    appearance: "none",
    background: util === key ? "#E1F9FF" : "transparent",
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
        /* --tm-bar is the nav row's current height. On phones the utility row
           is absolutely positioned over the bar, and it needs to stop there:
           stretching it to the header's full height (which it used to do) laid
           it over an open panel, floating the icons across the search field and
           swallowing clicks on the results underneath. */
        style={{ position: "fixed", top: 5, left: 0, right: 0, zIndex: 55, background: "#FFFFFF", borderBottom: "1px solid var(--color-divider)", "--tm-bar": `${barH}px` } as React.CSSProperties}
      >
        {/* utility row: contact · account · language · search */}
        <div
          className="tm-util"
          style={{ maxWidth: 1320, margin: "0 auto", padding: "0 32px", height: utilH, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, transition: "height .18s ease" }}
        >
          <div className="tm-util-contact" style={{ marginInlineEnd: "auto", display: "flex", alignItems: "center", gap: 20 }}>
            {/* Displayed, not dialled — a <span>, so a tap on a phone cannot
                start a call. Email is the channel that takes a click. */}
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--color-neutral-700)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              {/* Forced LTR. A phone number is a left-to-right run of digits and
                  punctuation; under dir=rtl the bidi algorithm reorders the
                  leading "+1" to the end and the number renders backwards. */}
              <bdi dir="ltr">{SUPPORT_PHONE}</bdi>
            </span>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="tm-utilink" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--color-neutral-700)", textDecoration: "none" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16"></rect><path d="m2 6 10 7 10-7"></path></svg>
              <bdi dir="ltr">{SUPPORT_EMAIL}</bdi>
            </a>
          </div>

          <div style={{ position: "relative", zIndex: 70 }}>
            <button onClick={() => toggleUtil("account")} aria-label={t("Log in")} title={t("Log in")} aria-expanded={util === "account"} style={iconBtn("account")}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="10" r="3"></circle><path d="M6.7 19a5.3 5.3 0 0 1 10.6 0"></path></svg>
            </button>
            {util === "account" && (
              <div className="blueprint tm-util-menu" style={{ position: "absolute", right: 0, top: 40, width: 262, background: "#FFFFFF", boxShadow: "var(--shadow-md)", padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                <Corners />
                <span className="fs11" style={{ letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-600)" }}>{t("Log in to the portal")}</span>
                {/* These point at the platform on another origin (see
                    platformHref), so they open in a new tab: someone reading
                    the site keeps their place instead of losing it to a
                    sign-in form. A plain anchor rather than next/link — there
                    is no client-side route to prefetch across origins. */}
                {PORTAL_LINKS.map((p) => (
                  <a key={p.label} href={p.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, color: "#113055" }}>{p.label} &nbsp;›</span>
                    <span className="fs125" style={{ color: "var(--color-neutral-600)" }}>{p.note}</span>
                  </a>
                ))}
                <span className="fs12" style={{ lineHeight: 1.5, color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
                  {t("Accounts are issued by your facility administrator.")}
                </span>
              </div>
            )}
          </div>

          <div style={{ position: "relative", zIndex: 70 }}>
            <button onClick={() => toggleUtil("lang")} aria-label={t("Change language")} title={t("Change language")} aria-expanded={util === "lang"} style={iconBtn("lang")}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"></path></svg>
            </button>
            {util === "lang" && (
              <div className="blueprint tm-util-menu" style={{ position: "absolute", right: 0, top: 40, width: 228, background: "#FFFFFF", boxShadow: "var(--shadow-md)", padding: "10px 0", display: "flex", flexDirection: "column" }}>
                <Corners />
                {SUPPORTED_LOCALES.map((l) => {
                  const active = l.code === locale;
                  return (
                    <button
                      key={l.code}
                      lang={l.code}
                      aria-current={active ? "true" : undefined}
                      onClick={() => { setLocale(l.code); setUtil(null); }}
                      style={{
                        appearance: "none", border: 0, background: "none", cursor: "pointer", textAlign: "start", padding: "9px 20px",
                        fontFamily: "var(--font-body)", fontSize: 14.5,
                        fontWeight: active ? 700 : 400,
                        color: active ? "#015697" : "#113055",
                        textDecoration: active ? "underline" : "none",
                        textUnderlineOffset: 4,
                      }}
                    >
                      {l.nativeName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button onClick={() => toggleUtil("search")} aria-label={t("Search")} title={t("Search")} aria-expanded={util === "search"} style={iconBtn("search")}>
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
            <Image
              src="/assets/tamam-logo-full.svg"
              alt={t("Tamam Healthcare System")}
              width={123}
              height={28}
              preload
              style={{ height: logoH, width: "auto", transition: "height .18s ease" }}
            />
          </Link>
          <nav className="tm-desktop-nav" style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="tm-navlink"
                onMouseEnter={() => setMenu(item.menu)}
                aria-current={activeHref === item.href ? "page" : undefined}
                style={{
                  fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, letterSpacing: "0.01em",
                  color: activeHref === item.href ? "#015697" : "#113055",
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
            <Link href="/contact" className="btn blueprint" style={{ marginInlineStart: 14, padding: "11px 20px", fontSize: 15, color: "#113055", whiteSpace: "nowrap", background: "#FF7F00", borderColor: "#FF7F00" }}>
              {t("Get in touch")}
              <Corners />
            </Link>
          </nav>
          <button className="tm-burger" onClick={() => toggleUtil("drawer")} aria-label={t("Menu")} aria-expanded={util === "drawer"} style={{ appearance: "none", marginInlineStart: "auto", background: "none", border: "1px solid var(--color-divider)", cursor: "pointer", width: 46, height: 46, placeItems: "center", color: "#015697" }}>
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
                <HashLink href={m.allHref} style={{ marginTop: "auto", fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16, color: "var(--color-accent-700)", textDecoration: "none" }}>
                  {m.allLabel} &nbsp;›
                </HashLink>
              </div>
              <div className="tm-g3" style={{ padding: "40px 0 44px 56px", gap: "26px 32px", alignContent: "start" }}>
                {m.links.map((link) => (
                  // HashLink, not Link: several of these point at a section of
                  // a page the reader may already be on (/platform#how-it-works).
                  <HashLink key={link.label} href={link.href} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: "var(--color-text)" }}>{link.label} &nbsp;›</span>
                    <span style={{ fontSize: 13, color: "var(--color-neutral-600)" }}>{link.note}</span>
                  </HashLink>
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
                style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, color: activeHref === item.href ? "#015697" : "#113055", textDecoration: "none", padding: "15px 28px", borderBottom: "1px solid var(--color-divider)" }}
              >
                {item.label}
              </Link>
            ))}
            <Link href="/contact" className="btn btn-primary" style={{ margin: "16px 28px 0", padding: "14px 0", fontSize: 16, color: "#113055" }}>
              {t("Get in touch")}
            </Link>
          </div>
        )}

        {/* search panel */}
        {util === "search" && (
          <div style={{ borderTop: "1px solid var(--color-divider)", background: "var(--color-surface)", padding: "56px 32px 60px", boxShadow: "var(--shadow-md)" }}>
            <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
              <h2 style={{ fontSize: "clamp(24px, 3.4vw, 38px)", margin: 0, textAlign: "center" }}>{t("What can we help you with?")}</h2>
              {/* A form, so Enter submits the way it does in every other search
                  field on the web — and so the magnifier is a submit button
                  rather than decoration. Enter opens whichever result the
                  keyboard is on, which is the first one until it is moved. */}
              <form
                onSubmit={(e) => { e.preventDefault(); if (hits[active]) openHit(hits[active]); }}
                className="blueprint"
                style={{ width: "100%", display: "flex", alignItems: "center", background: "#FFFFFF", borderWidth: 2, borderColor: "#2191D0", padding: "4px 12px 4px 18px" }}
              >
                <Corners />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                  onKeyDown={onSearchKeyDown}
                  placeholder={t("Search")}
                  aria-label={t("Search the site")}
                  role="combobox"
                  aria-expanded={hits.length > 0}
                  aria-controls="tm-search-results"
                  aria-activedescendant={hits.length ? `tm-search-opt-${active}` : undefined}
                  aria-autocomplete="list"
                  autoComplete="off"
                  style={{ flex: 1, border: 0, outline: "none", background: "none", fontFamily: "var(--font-body)", fontSize: 17, color: "#113055", padding: "12px 0" }}
                />
                <button type="submit" aria-label={t("Run search")} style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", width: 40, height: 40, display: "grid", placeItems: "center", color: "#015697" }}>
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4.5 4.5"></path></svg>
                </button>
              </form>

              {/* Results while typing; the suggestions below take over again
                  when the field is empty. */}
              {hits.length > 0 && (
                <ul
                  id="tm-search-results"
                  role="listbox"
                  aria-label={t("Search results")}
                  className="blueprint"
                  style={{ width: "100%", listStyle: "none", margin: 0, padding: 0, background: "#FFFFFF" }}
                >
                  {hits.map((hit, i) => (
                    <li key={hit.href} id={`tm-search-opt-${i}`} role="option" aria-selected={i === active}>
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => openHit(hit)}
                        style={{
                          appearance: "none", border: 0, cursor: "pointer", width: "100%", textAlign: "left",
                          font: "inherit", color: "inherit", display: "flex", alignItems: "baseline", gap: 16,
                          padding: "13px 18px", background: i === active ? "rgba(1,86,151,0.09)" : "#FFFFFF",
                          borderTop: i === 0 ? "0" : "1px solid var(--color-divider)",
                        }}
                      >
                        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18, lineHeight: 1.25 }}>{t(hit.title)}</span>
                          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--color-neutral-600)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t(hit.summary)}
                          </span>
                        </span>
                        <span className="fs12" style={{ flex: "none", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>
                          {t(hit.kind)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Typed something the site does not answer. Say so, and say what
                  would work — a dead end with no next move is what makes a
                  search box feel broken. */}
              {hits.length === 0 && query.trim().length >= 2 && (
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-700)", textAlign: "center" }}>
                  {t("Nothing on the site matches that. Try a product name (HMIS, pharmacy), a place, or what you are trying to do: reporting, referrals, donate.")}
                </p>
              )}

              {!query.trim() && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {SEARCH_SUGGESTIONS.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => goTo(q.href)}
                      className="tag tag-accent fs125"
                      style={{ appearance: "none", border: 0, cursor: "pointer", fontFamily: "var(--font-body)", padding: "7px 14px" }}
                    >
                      {t(q.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </header>
      <div className="tm-head-spacer" />
    </>
  );
}
