/**
 * Which photograph the sign-in page shows, by the door the visitor came
 * through.
 *
 * tamamhealth.org offers four ways in — facility staff, patient, ministry,
 * platform admin — and three of them (everything but the patient portal, which
 * is its own page with its own picture) land on this one `/login`. They arrived
 * at an identical screen showing a doctor at a workstation, so a ministry
 * official and a platform operator were both told, in the only wordless part of
 * the page, that they were signing in to clinical work.
 *
 * The door travels as `?portal=` on the link. This is deliberately NOT keyed on
 * the role picked in the form: the picture answers "which product is this?",
 * which is settled before anyone types, and swapping it under a person as they
 * choose their role is movement that says nothing.
 */

/** The doors that land here. `patient` is not among them — it has its own page. */
export type LoginPortal = 'staff' | 'ministry' | 'admin';

export interface PortalShot {
  src: string;
  /** i18n key for the alt text — these are photographs of real work. */
  altKey: string;
}

const SHOTS: Record<LoginPortal, PortalShot> = {
  // Unchanged: the staff door is the one this page was drawn for.
  staff: { src: '/assets/doctor-at-workstation.jpg', altKey: 'login.shotStaffAlt' },
  // National reporting — the figures a ministry signs in to read, not a ward.
  ministry: { src: '/assets/health-data.jpg', altKey: 'login.shotMinistryAlt' },
  // The estate a platform operator provisions: facilities, not patients.
  admin: { src: '/assets/facility-network.jpg', altKey: 'login.shotAdminAlt' },
};

export const DEFAULT_PORTAL: LoginPortal = 'staff';

/**
 * Read the door out of a `?portal=` value.
 *
 * Anything unrecognised is the staff door — a mistyped or stale link should
 * open the page this URL has always opened, not an empty frame.
 */
export function portalFromParam(value: string | null | undefined): LoginPortal {
  if (value === 'ministry') return 'ministry';
  // The website calls this door "superadmin"; the platform calls the console
  // "admin". Both spellings arrive here, and both mean the same door.
  if (value === 'admin' || value === 'superadmin') return 'admin';
  return DEFAULT_PORTAL;
}

export function shotForPortal(portal: LoginPortal): PortalShot {
  return SHOTS[portal] ?? SHOTS[DEFAULT_PORTAL];
}
