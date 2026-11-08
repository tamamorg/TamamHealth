"use client";

/* Lets lazy photographs fade in as they arrive (globals.css, Motion).
   The page is marked `tm-js` only here, after hydration, in the same tick as
   every image that has already loaded is marked loaded, so nothing visible is
   hidden; images still on their way then fade in on their load event. Without
   JavaScript the class never appears and images show exactly as before. */

import { useEffect } from "react";

export default function ImageFadeIn() {
  useEffect(() => {
    const mark = (img: HTMLImageElement) => img.setAttribute("data-loaded", "");
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement) mark(event.target);
    };
    // Load events do not bubble; capture them at the document.
    document.addEventListener("load", onLoad, true);
    document.addEventListener("error", onLoad, true);
    document.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      if (img.complete) mark(img);
    });
    document.documentElement.classList.add("tm-js");
    return () => {
      document.removeEventListener("load", onLoad, true);
      document.removeEventListener("error", onLoad, true);
    };
  }, []);
  return null;
}
