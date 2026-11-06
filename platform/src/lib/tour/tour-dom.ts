/**
 * Whether an application dialog, rather than the guided-tour card itself, is
 * currently open. The distinction is load-bearing: TourCard uses the dialog
 * role for accessibility and must not cause TourProvider to suspend itself.
 *
 * `stepTarget` is the current step's selector. A dialog that holds that
 * target (or is it) is the thing the step is pointing at, usually opened by
 * the step's own preClickSelector (the patient list's Filters panel), so it
 * does not count: suspending there hid the card the step was about and left
 * the tour stuck with no way forward (found by the 2026-11-05 tour check).
 */
export function hasBlockingDialog(root: ParentNode = document, stepTarget?: string): boolean {
  const dialogs = root.querySelectorAll<HTMLElement>('[role="dialog"]:not(.tour-card)');
  for (const dialog of dialogs) {
    if (stepTarget && holdsTarget(dialog, stepTarget)) continue;
    return true;
  }
  return false;
}

function holdsTarget(dialog: HTMLElement, selector: string): boolean {
  try {
    return dialog.matches(selector) || dialog.querySelector(selector) !== null;
  } catch {
    return false;
  }
}
