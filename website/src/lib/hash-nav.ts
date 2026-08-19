/**
 * Links that point at a section of the page you are already on.
 *
 * Next's router compares URLs: pushing the URL the address bar already holds is
 * a no-op, so "/platform#how-it-works" clicked while sitting on
 * /platform#how-it-works does nothing at all. That is invisible until a reader
 * arrives at a section, scrolls somewhere else, then uses the search panel (or
 * the menu, or the footer) to go back to it — and the page just sits there. It
 * reads as a broken link, and it is the reason the DHIS2 entries appeared not
 * to work.
 *
 * So same-page hash targets scroll themselves rather than going through the
 * router. `section[id]` already carries scroll-margin-top for the fixed header,
 * and `html` carries scroll-behavior: smooth (switched off under
 * prefers-reduced-motion), so the scroll is left to CSS — no behavior option
 * here, or the reader who asked for less motion gets it anyway.
 */

/**
 * The element id to scroll to if `href` names a section of `pathname`, else
 * null — meaning it is an ordinary navigation and belongs to the router.
 */
export function hashTargetOnPage(href: string, pathname: string): string | null {
  if (/^[a-z]+:/i.test(href)) return null; // http(s):, mailto:, tel:
  const [path, hash] = href.split("#");
  if (!hash) return null;
  // "#levels" (no path) is by definition this page; "/platform#offline" only
  // when that is where we already are.
  const target = path === "" ? pathname : path;
  return target === pathname ? hash : null;
}

/** Scrolls to the element and puts the fragment in the address bar. Returns
    false when nothing on the page has that id, so the caller can fall back to
    a real navigation rather than swallowing the click. */
export function scrollToHash(hash: string): boolean {
  const el = document.getElementById(hash);
  if (!el) return false;
  el.scrollIntoView({ block: "start" });
  // replaceState, not pushState: the reader is already on this page, and a
  // history entry per section makes Back walk the sections instead of leaving.
  window.history.replaceState(window.history.state, "", `#${hash}`);
  return true;
}
