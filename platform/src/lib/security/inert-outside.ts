/**
 * Make everything outside `keep` unreachable (`inert` + aria-hidden) so a lock
 * overlay actually blocks the app behind it: no tabbing, typing, clicking or
 * screen-reader access (security audit 2026-11 M4). Siblings are marked along
 * the path from `keep` up to <body>, so portals (sliders, dialogs, toasts) are
 * covered too, including ones added while locked. Returns the undo.
 */
const MARK = 'data-lock-inert';

export function inertOutside(keep: HTMLElement): () => void {
  const apply = () => {
    let node: HTMLElement | null = keep;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        if (sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE' || sibling.tagName === 'LINK') continue;
        if (sibling.hasAttribute(MARK)) continue;
        sibling.setAttribute(MARK, '');
        sibling.setAttribute('inert', '');
        sibling.setAttribute('aria-hidden', 'true');
      }
      node = parent;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && !keep.contains(active)) active.blur();
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    document.querySelectorAll(`[${MARK}]`).forEach(el => {
      el.removeAttribute(MARK);
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    });
  };
}
