/**
 * Whether an application dialog, rather than the guided-tour card itself, is
 * currently open. The distinction is load-bearing: TourCard uses the dialog
 * role for accessibility and must not cause TourProvider to suspend itself.
 */
export function hasBlockingDialog(root: ParentNode = document): boolean {
  return root.querySelector('[role="dialog"]:not(.tour-card)') !== null;
}
