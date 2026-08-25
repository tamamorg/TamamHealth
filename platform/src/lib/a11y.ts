import type { KeyboardEvent, SyntheticEvent } from 'react';

/**
 * Make a non-button element behave like a button for someone who is not
 * holding a mouse.
 *
 * ## Why this exists
 *
 * An audit on 2026-08-24 found 129 click handlers on plain `<div>`s and
 * `<section>`s across 43 files, none of them reachable from the keyboard. The
 * worst concentration was the patient chart (16), where the facesheet panels —
 * Medications, Allergies, Latest observations — are each a whole card you
 * click to open the matching tab. A clinician working keyboard-first, which is
 * how people work when they are fast and the workstation is shared, could not
 * reach any of them.
 *
 * ## Why not just use a <button>
 *
 * These cards contain their own interactive rows, and HTML forbids nesting
 * interactive content inside a button — the markup would be invalid and screen
 * readers would flatten the inner controls. The accessible pattern for a
 * clickable container is the one below: an explicit role, a tab stop, and
 * Enter/Space wired to the same handler as the click.
 *
 * Where an element is a plain control with no interactive children, prefer a
 * real `<button>`. This is for the case where you genuinely cannot.
 *
 * ## Space, and why preventDefault
 *
 * Space scrolls the page by default. A button that scrolls instead of
 * activating is worse than one that does nothing, because the user believes
 * they pressed something else.
 *
 * @example
 *   <section className="tebra-panel" {...clickable(() => onOpenTab('vitals'))}>
 */
export function clickable(
  onActivate: (event: SyntheticEvent) => void,
  options: {
    /** Announced by a screen reader. Give one when the visible text is not enough. */
    label?: string;
    /** Set false to keep the element out of the tab order (rare — usually a bug). */
    focusable?: boolean;
  } = {},
) {
  const { label, focusable = true } = options;
  return {
    role: 'button' as const,
    tabIndex: focusable ? 0 : -1,
    ...(label ? { 'aria-label': label } : {}),
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Space scrolls; Enter can submit a surrounding form. Neither is what
      // the user asked for by activating this control.
      event.preventDefault();
      onActivate(event);
    },
  };
}

/**
 * Swallow a click so it does not reach a parent handler — typically the
 * content of a modal whose backdrop closes on click.
 *
 * Spread this instead of writing `onClick={e => e.stopPropagation()}`, which
 * lints as an interactive element and is not one: nothing here is activatable,
 * the element only refuses to forward an event it never wanted. Keyboard users
 * are unaffected, because there was never anything to activate.
 */
export const stopsClickPropagation = {
  onClick: (event: SyntheticEvent) => event.stopPropagation(),
  // Not interactive — say so, rather than letting a linter guess from onClick.
  role: 'presentation' as const,
};

/**
 * A backdrop or scrim that dismisses what it sits behind when clicked.
 *
 * Deliberately NOT `clickable()`. A click-outside dismissal is a mouse
 * convenience, and giving every scrim `role="button"` and a tab stop would put
 * a meaningless, unlabelled stop in front of every modal in the app — worse
 * for a keyboard user than leaving it alone, because now they must tab past a
 * control that announces nothing.
 *
 * The keyboard equivalent of clicking a backdrop is **Escape**, which belongs
 * to the dialog, not to the scrim. So this marks the element as presentational
 * — which is the truth — and the component keeps its own Escape handler.
 *
 * If you spread this and the surrounding dialog does NOT close on Escape, the
 * dismissal is genuinely mouse-only and that is the bug to fix.
 */
export function dismissBackdrop(onDismiss: (event: SyntheticEvent) => void) {
  return {
    role: 'presentation' as const,
    onClick: onDismiss,
  };
}
