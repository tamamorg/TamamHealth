'use client';

import './login-chrome.css';

/**
 * The chrome both sign-in screens are drawn in: the marketing site's login
 * language (tamamhealth.org), which the staff login at /login established and
 * the patient portal's sign-in now shares — centred logo bar, a two-column
 * body with the form on the left and a blueprint panel on the right,
 * square-cornered fields with registration marks, Barlow typography, and the
 * one amber call to action.
 *
 * It lives here, not in either page, so a staff door and a patient door cannot
 * drift into two different-looking front steps of the same building. Both
 * routes must load Barlow / Barlow Condensed into --lg-font-body /
 * --lg-font-heading (their layouts do it with next/font).
 */

/** The blueprint frame's four registration marks (the site's `Corners`). */
export function Corners() {
  return (
    <>
      <i className="lg-corner tl" />
      <i className="lg-corner tr" />
      <i className="lg-corner bl" />
      <i className="lg-corner br" />
    </>
  );
}

/* The marketing site's login tokens, kept to the sign-in routes so the
   platform palette is untouched. Values mirror website/src/app/globals.css. */
