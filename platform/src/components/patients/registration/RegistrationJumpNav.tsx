'use client';

/**
 * The registration form's table of contents — a list of jump links, one per
 * section, marked with Tamam's corner arrow.
 *
 * It was `RegistrationProgressRail` and it drew progress: a spine that filled
 * with the share of required fields answered, a conic sweep per section node,
 * and a running count beside every label. All of that went with the Tamam
 * restyle, and the name outlived it. What is left answers one question —
 * WHERE YOU ARE — and marks the current section by colour alone. How much is
 * done is answered at the field, which is where it gets fixed.
 *
 * Presentational. It owns no state: the section counts come from
 * `sectionRequirementProgress` and the active section from the form's
 * scroll-spy, so the same nav can be driven by a page or by a dialog.
 *
 * Adds no translation strings: the only word is `patientNew.optionalLabel`,
 * which exists in all eleven locales. A new key would print raw as
 * "patientNew.foo" in the ten that lag `en.ts`.
 */

import type { SectionProgress } from './registration-progress';

export interface RegistrationJumpNavProps {
  /** Section names, in `SECTION_ANCHORS` order. */
  sectionLabels: string[];
  /** Per section, how many required fields are answered out of how many. */
  sectionProgress: SectionProgress[];
  /**
   * Whether Review is still out of reach. Offering it before the form would
   * submit only produces a bounce back to the first missing field.
   */
  reviewLocked: boolean;
  /** Index of the section currently on screen. */
  activeSection: number;
  /** Sections whose fields failed the last validation. */
  errorSections: Set<number>;
  /** Jump to a section of the form. */
  onSelectSection: (index: number) => void;
  /** Open the review step (the last entry). */
  onOpenReview: () => void;
  /** Word for a section with nothing required — pass `t('patientNew.optionalLabel')`. */
  optionalLabel: string;
}

export default function RegistrationJumpNav({
  sectionLabels,
  sectionProgress,
  reviewLocked,
  activeSection,
  errorSections,
  onSelectSection,
  onOpenReview,
  optionalLabel,
}: RegistrationJumpNavProps) {
  return (
    <nav className="tamam-reg-nav">
      {sectionLabels.map((label, i) => {
        const { done, total } = sectionProgress[i];
        const hasErrors = errorSections.has(i);
        // The last entry is Review — a destination, not a place in the form —
        // so it opens the read-back instead of scrolling.
        const isReviewStep = i === sectionLabels.length - 1;
        const isLocked = isReviewStep && reviewLocked;
        const isOptional = !isReviewStep && total === 0;
        // The only trailing marks: a flag on a section the last submit could
        // not accept, and the word "optional" on one that asks for nothing.
        const meta = hasErrors ? '!' : isOptional ? optionalLabel : null;
        return (
          <button
            key={label}
            type="button"
            onClick={() => (isReviewStep ? onOpenReview() : onSelectSection(i))}
            disabled={isLocked}
            className={`tamam-reg-navitem${hasErrors ? ' has-errors' : ''}${i === activeSection ? ' is-current' : ''}`}
            data-state={isOptional ? 'optional' : undefined}
            aria-current={i === activeSection ? 'true' : undefined}
            // The count survives here, where a screen reader still hears the
            // progress the markers no longer draw.
            aria-label={total > 0 ? `${label} ${done}/${total}` : label}
          >
            {/* Tamam marks a jump link with a corner arrow. */}
            <span className="tamam-reg-navarrow" aria-hidden>↳</span>
            <span className="tamam-reg-navlabel">{label}</span>
            {meta && <span className="tamam-reg-navmeta" aria-hidden>{meta}</span>}
          </button>
        );
      })}
    </nav>
  );
}
