"use client";

/* Turns a group of sibling cards into a swipeable carousel on a phone, while
 * leaving the desktop grid exactly as it was. The same container keeps its
 * grid class (e.g. "tm-g3") for desktop; the added `.tm-carousel` marker flips
 * it to a horizontal scroll-snap track ≤639px (see globals.css), and the
 * HeroNav control below reflects and drives the scroll position — the same ‹ ›
 * progress bar the home page already uses.
 *
 * Children are passed straight through (no per-card wrapper), so the cards stay
 * direct grid items and every desktop rule that targets them still matches. */

import { Children, useEffect, useRef, useState } from "react";
import HeroNav from "@/components/HeroNav";

export default function CardCarousel({
  children,
  className = "",
  style,
  labels,
  prevLabel = "Previous",
  nextLabel = "Next",
}: {
  children: React.ReactNode;
  /** The grid class this group already used, e.g. "tm-g3". Kept for desktop. */
  className?: string;
  style?: React.CSSProperties;
  /** Short label per card for the nav dots / assistive tech (acronym, title). */
  labels?: string[];
  prevLabel?: string;
  nextLabel?: string;
}) {
  const count = Children.count(children);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // A single card is nothing to swipe through — render the plain grid, no
  // track and no control. (Hooks below still run; they no-op with one child.)
  const isCarousel = count > 1;

  // Derive the active card from scroll position: whichever slide's centre is
  // nearest the track's centre. rAF-throttled so scrolling stays smooth.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      Array.from(track.children).forEach((el, i) => {
        const c = (el as HTMLElement).offsetLeft + (el as HTMLElement).offsetWidth / 2;
        const d = Math.abs(c - mid);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [count]);

  const goTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(count - 1, i));
    const el = track.children[clamped] as HTMLElement | undefined;
    if (!el) return;
    // Centre the target slide in the track without nudging the page vertically.
    track.scrollTo({ left: el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2, behavior: "smooth" });
  };

  if (!isCarousel) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <>
      <div ref={trackRef} className={`${className} tm-carousel`.trim()} style={style}>
        {children}
      </div>
      {/* Wrapper lets CSS confine the control to the ≤639px carousel range, so
          it never shows over the still-gridded 2-up layout at 640–760px. */}
      <div className="tm-carousel-nav">
        <HeroNav
          items={Array.from({ length: count }, (_, i) => ({ key: String(i), label: labels?.[i] ?? `${i + 1}` }))}
          active={active}
          onPick={goTo}
          onPrev={() => goTo(active - 1)}
          onNext={() => goTo(active + 1)}
          prevLabel={prevLabel}
          nextLabel={nextLabel}
        />
      </div>
    </>
  );
}
