/**
 * "Show, don't move": the DOM side of the guided tour's visible clicks.
 *
 * The tour used to change page with router.push and to fire its pre-clicks
 * instantly, so a new user saw the screen change under them without ever
 * seeing which control did it (the user's words, 2026-11-05: "show, don't
 * just move"). Every automatic click now goes through the same sequence:
 * point at the real control, label it ("Click “Patients”"), pause, click.
 *
 * These helpers find that control. A page is reached the way a user would
 * reach it: a visible link or top-bar shortcut for its address first, then
 * the ☰ module menu (opening it, and the group that holds the page). Both the
 * menu items and the shortcuts carry `data-href` for exactly this.
 */

/**
 * How long the pointer rests on a control before the tour clicks it. 1.1 s
 * was too quick to follow (the user, 2026-11-05); this is long enough to
 * read the caption and find the control on screen.
 */
export const CLICK_PAUSE_MS = 2200;

/** After the click: a beat to watch the page change before the next card. */
export const SETTLE_MS = 800;

/** Before the pointer: let a scrolled-to control come to rest. */
export const SCROLL_SETTLE_MS = 450;

/** The ☰ module menu trigger on the top rail. */
export const MODULE_TRIGGER = '.ehr-module-trigger';

/** Rendered, sized, and not inside the tour's own card. */
export function isShown(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.closest('.tour-card')) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = window.getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

function attrSelector(name: string, value: string, op = '='): string {
  return `[${name}${op}"${value.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * A visible control that opens `path`: a module-menu item or top-bar
 * shortcut (`data-href`), or a plain link to it.
 */
export function findNavControl(path: string, root: ParentNode = document): HTMLElement | null {
  const selector = `${attrSelector('data-href', path)}, a${attrSelector('href', path)}`;
  for (const el of root.querySelectorAll(selector)) {
    if (isShown(el)) return el;
  }
  return null;
}

/** A collapsed module-menu group that holds the item for `path`. */
export function findMenuGroup(path: string, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll(attrSelector('data-hrefs', path, '~='))) {
    if (isShown(el)) return el;
  }
  return null;
}

/**
 * What the pointer's caption calls a control: its accessible name, else its
 * first real line of text. A row leads with an avatar's initials ("SM"), so
 * a short all-capitals line is skipped in favour of the name after it.
 */
export function clickLabel(el: HTMLElement): string {
  const named = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
  const text = named || (el.innerText || el.textContent || '');
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const initials = (line: string) => line.length <= 3 && line === line.toUpperCase();
  const line = lines.find(l => !initials(l)) || lines[0] || '';
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

/**
 * Close an application dialog the next step has no use for (a visit popup a
 * row opened two steps back): the tour hides while any dialog is open, so a
 * forgotten one stalled the walkthrough. Escape is what every dialog here
 * answers; the tour's own Escape handler yields while a dialog is open, so
 * this never ends the tour.
 */
export function closeStrayDialog(keepTarget?: string, root: Document = document): void {
  const dialogs = [...root.querySelectorAll<HTMLElement>('[role="dialog"]:not(.tour-card)')];
  const stray = dialogs.filter(d => {
    if (!keepTarget) return true;
    try { return !(d.matches(keepTarget) || d.querySelector(keepTarget)); } catch { return true; }
  });
  if (stray.length === 0) return;
  const from = (root.activeElement as HTMLElement | null) && stray.some(d => d.contains(root.activeElement))
    ? root.activeElement as HTMLElement
    : stray[stray.length - 1];
  from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}
