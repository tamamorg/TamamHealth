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

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Grid-like containers whose children arrive one by one. */
const STAGGER_PARENTS = [
  ".tm-g3", ".tm-g4", ".tm-g6", ".tm-solution-grid", ".tm-problem-breaks",
  ".tm-explain", ".tm-lead-grid",
].map((s) => `main ${s}`).join(",");

/** Everything else: the direct blocks of each section's content column. */
const BLOCKS = "main section > div > *, main section > div > div > h2, main section > div > div > p";

export default function SiteMotion() {
  const pathname = usePathname();

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

  return null;
}
