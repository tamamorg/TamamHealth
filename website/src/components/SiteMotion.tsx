"use client";

/* Scroll reveal for the marketing site.

   Content below the fold rises and fades in as it enters the viewport; the
   cards of a grid arrive one after another. Nothing is hidden by the server
   render: the hidden state (`.tm-rv`) is added here, after hydration, and
   only to elements that are still below the fold — so a page without
   JavaScript, a crawler, a print, and the first screen of every page all
   show their content at once.

   Re-runs on every client navigation (the App Router keeps this component
   mounted across pages). Does nothing when the visitor asks for reduced
   motion or the browser has no IntersectionObserver. */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** A bare figure: "$100,000", "4%", "1.42", "12mo", "10". */
const FIGURE = /^(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%|K|M|\+|mo)?$/;

/** Count every large bare figure on the page up from zero as it scrolls into
    view. English only (the translated figures use Arabic-Indic digits), and
    the element always ends on its original text. */
function countFigures(): () => void {
  const fold = window.innerHeight * 0.9;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target as HTMLElement;
      const final = el.dataset.tmFinal ?? "";
      const m = final.match(FIGURE);
      if (!m) continue;
      const [, pre, int, dec = "", suf = ""] = m;
      const target = parseFloat(int.replace(/,/g, "") + dec);
      const places = dec ? dec.length - 1 : 0;
      const commas = int.includes(",");
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 1100);
        const v = target * (1 - Math.pow(1 - p, 3));
        if (p >= 1) { el.textContent = final; return; }
        const n = places ? v.toFixed(places) : String(Math.round(v));
        el.textContent = pre + (commas ? Number(n).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places }) : n) + suf;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, { threshold: 0.5 });
  const els: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>("main *").forEach((el) => {
    if (el.childElementCount || el.closest("[data-countup]")) return;
    const text = (el.textContent ?? "").trim();
    // Step numbers ("01", "02") are labels, not quantities.
    if (!FIGURE.test(text) || /^0\d/.test(text) || parseFloat(getComputedStyle(el).fontSize) < 28) return;
    if (el.getBoundingClientRect().top < fold) return;
    el.dataset.tmFinal = text;
    const m = text.match(FIGURE);
    el.textContent = `${m?.[1] ?? ""}0${m?.[4] ?? ""}`;
    els.push(el);
    io.observe(el);
  });
  return () => {
    io.disconnect();
    els.forEach((el) => { if (el.dataset.tmFinal) el.textContent = el.dataset.tmFinal; });
  };
}

/** Grid-like containers whose children arrive one by one. */
const STAGGER_PARENTS = [
  ".tm-g3", ".tm-g4", ".tm-g6", ".tm-solution-grid", ".tm-problem-breaks",
  ".tm-explain", ".tm-lead-grid",
].map((s) => `main ${s}`).join(",");

/** Everything else: the direct blocks of each section's content column. */
const BLOCKS = "main section > div > *, main section > div > div > h2, main section > div > div > p";

export default function SiteMotion() {
  const pathname = usePathname();
  const { locale, t } = useLanguage();
  const [showTop, setShowTop] = useState(false);

  // Scroll state: a progress line under the top accent bar, the header's
  // scrolled look, and the back-to-top button.
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = root.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      root.style.setProperty("--tm-scroll", String(max > 0 ? Math.min(1, y / max) : 0));
      root.classList.toggle("tm-scrolled", y > 8);
      setShowTop(y > window.innerHeight * 1.2);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, [pathname]);

  // Figures count up (English only).
  useEffect(() => {
    if (!("IntersectionObserver" in window) || locale !== "en") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return countFigures();
  }, [pathname, locale]);

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const fold = window.innerHeight * 0.92;
    const below = (el: Element) => el.getBoundingClientRect().top > fold;
    // A swipeable row (phone carousels, scrolling rails) keeps its cards
    // visible: one revealed only once swiped into view reads as a blank card.
    const inSideways = (el: Element) => {
      for (let n = el.parentElement; n && n.tagName !== "MAIN"; n = n.parentElement) {
        if (n.classList.contains("tm-carousel")) return true;
        const ox = getComputedStyle(n).overflowX;
        if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
      }
      return false;
    };
    const marked: HTMLElement[] = [];
    const mark = (el: HTMLElement, delay = 0) => {
      el.classList.add("tm-rv");
      el.style.setProperty("--rv-d", `${delay}ms`);
      marked.push(el);
    };

    // Grid children first, staggered across the row.
    document.querySelectorAll<HTMLElement>(STAGGER_PARENTS).forEach((grid) => {
      Array.from(grid.children).forEach((child, i) => {
        if (child instanceof HTMLElement && below(child) && !inSideways(child)) mark(child, (i % 4) * 90);
      });
    });
    // Then the remaining blocks, skipping anything already inside (or
    // containing) a marked element so nothing animates twice.
    document.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => {
      if (el.classList.contains("tm-rv") || el.closest(".tm-rv") || el.querySelector(".tm-rv")) return;
      if (el.offsetHeight === 0 || !below(el) || inSideways(el)) return;
      mark(el);
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.classList.add("is-in");
          io.unobserve(el);
          // Once settled, drop the classes so the reveal leaves no transform
          // or opacity behind to fight the element's own styles.
          window.setTimeout(() => el.classList.remove("tm-rv", "is-in"), 900 + (parseInt(el.style.getPropertyValue("--rv-d")) || 0));
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.01 },
    );
    marked.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      // A page left mid-scroll must not carry hidden elements into the next
      // render of the same nodes.
      marked.forEach((el) => el.classList.remove("tm-rv", "is-in"));
    };
  }, [pathname]);

  return (
    <>
      <div className="tm-progress" aria-hidden="true" />
      <button
        type="button"
        className={`tm-totop${showTop ? " is-on" : ""}`}
        aria-label={t("Back to top")}
        tabIndex={showTop ? 0 : -1}
        onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
      </button>
    </>
  );
}
