/**
 * Registration section identity and progress arithmetic.
 *
 * Kept out of the form component so the rail, the review read-back and the
 * form all agree on what a section is and when it is finished, and so the
 * counting can be tested without rendering anything.
 */

/**
 * Anchor ids for the rail's jump links, in the same order as the step labels
 * and the sections on the page.
 *
 * Biometrics sits second, directly under Demographics: the photo and
 * fingerprints are taken while the patient is still being identified, not
 * after their address and next of kin have been typed.
 *
 * This array is the ONE place the order is written down. The step labels, the
 * requirement counts, the review read-back and the validation all index into
 * it, so a reorder here has to be a reorder there — use the named constants
 * below rather than literals.
 */
export const SECTION_ANCHORS = [
  'demographics', 'biometrics', 'contact', 'nextofkin', 'coverage', 'review',
] as const;

export type SectionAnchor = typeof SECTION_ANCHORS[number];

/** Named positions, so nothing downstream hard-codes 0/1/2. */
export const DEMOGRAPHICS_SECTION = 0;
export const BIOMETRICS_SECTION = 1;
export const CONTACT_SECTION = 2;
export const NEXTOFKIN_SECTION = 3;
export const COVERAGE_SECTION = 4;

/** Index of the Review step — a destination rather than a part of the form. */
export const REVIEW_SECTION = SECTION_ANCHORS.length - 1;

/** The sections that have anything to validate, in page order. */
export const VALIDATED_SECTIONS = [
  DEMOGRAPHICS_SECTION, CONTACT_SECTION, NEXTOFKIN_SECTION,
] as const;

export interface SectionProgress {
  /** Required fields answered in this section. */
  done: number;
  /** Required fields the section has at all; 0 means the section is optional. */
  total: number;
}

/** The subset of the registration form the progress count depends on. */
export interface RegistrationRequirementInput {
  registrationFacility: string;
  firstName: string;
  surname: string;
  gender: string;
  dateOfBirth: string;
  estimatedAge: string;
  primaryLanguage: string;
  state: string;
  county: string;
  nokName: string;
  nokRelationship: string;
  nokPhone: string;
}

const filled = (value: string) => Boolean(value && value.trim());

export interface RequirementOptions {
  /**
   * True when the signed-in user carries no facility of their own and must
   * therefore name the one they are registering at. Passed in rather than
   * derived from the form because it is a fact about the user, not the patient
   * — and the rail must not mark a field required that Register does not ask
   * for, or the reverse.
   */
  facilityRequired?: boolean;
}

/**
 * What each section still needs, mirroring the form's `validateStep` exactly.
 *
 * The rail must count the same things Register refuses to submit without, or it
 * promises a section is finished and the submit then bounces off it. Sections
 * with nothing required (biometrics, coverage, review) report a total of 0 and
 * read as optional rather than as permanently unfinished.
 */
export function sectionRequirementProgress(
  form: RegistrationRequirementInput,
  options: RequirementOptions = {},
): SectionProgress[] {
  // One entry per SECTION_ANCHORS position, in that order.
  const requirements: boolean[][] = [
    /* demographics */ [...(options.facilityRequired ? [filled(form.registrationFacility)] : []),
      filled(form.firstName), filled(form.surname), filled(form.gender),
      filled(form.dateOfBirth) || filled(form.estimatedAge), filled(form.primaryLanguage)],
    /* biometrics   */ [],
    /* contact      */ [filled(form.state), filled(form.county)],
    /* next of kin  */ [filled(form.nokName), filled(form.nokRelationship), filled(form.nokPhone)],
    /* coverage     */ [],
    /* review       */ [],
  ];
  return requirements.map(flags => ({
    done: flags.filter(Boolean).length,
    total: flags.length,
  }));
}

/**
 * Nearest ancestor that actually scrolls, or null for the viewport.
 *
 * The form renders both as a full page and inside the front desk's
 * registration dialog. In the dialog the window never scrolls — the modal body
 * does — so anything that reasons about scroll position (the rail's scroll-spy,
 * "jump to top" when review opens) has to find the real container instead of
 * assuming the viewport.
 */
export function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}
