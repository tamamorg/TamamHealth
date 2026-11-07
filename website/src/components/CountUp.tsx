"use client";

/* A statistic that counts up once when it scrolls into view.

   The server renders the final, translated figure (`display`), so crawlers,
   no-JS visitors and reduced-motion visitors see the real number. The count
   only runs in English, where the animated digits match the figure; in
   Arabic the translated figure (Arabic-Indic digits) is shown as is. */

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function CountUp({ to, prefix = "", suffix = "", display }: { to: number; prefix?: string; suffix?: string; display: string }) {
  const { locale } = useLanguage();
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(display);

  useEffect(() => {
    const el = ref.current;
    if (!el || locale !== "en" || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return; // already on screen: leave it
    let raf = 0;
    setText(`${prefix}0${suffix}`);
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const dur = 1100;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setText(p < 1 ? `${prefix}${Math.round(to * eased)}${suffix}` : display);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); setText(display); };
  }, [to, prefix, suffix, display, locale]);

  return <span ref={ref}>{text}</span>;
}
