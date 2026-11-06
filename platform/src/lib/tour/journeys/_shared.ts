import type { TourStep } from '../types';

/* Steps every workspace ends with, parameterised by the route they sit on.
   Shared so one wording change reaches every journey. */

export const searchStep = (route: string): TourStep => ({
  id: 'search',
  route,
  target: '.ehr-top-search',
  title: 'Find any patient',
  body: 'Search by name, hospital number, or phone from anywhere in the app.',
  placement: 'bottom',
});

export const messagingStep = (route: string): TourStep => ({
  id: 'messaging',
  route,
  // The floating chat bubble (MessagingDock), bottom right on every screen.
  // The sidebar link used to be the anchor, but the side menu now sits
  // collapsed behind ☰, so that link measured as nothing and this card fell
  // back to the centre for every role (2026-11-05 tour check).
  target: '[data-tour="messaging-dock"]',
  title: 'Message your team',
  // The bubble only renders on /dashboard pages; on a home elsewhere (org
  // admin, super admin, ministry) the card simply centres, and the wording
  // holds either way.
  body: 'Direct messages, plus group threads for a whole ward or department. Open them from the chat bubble on your dashboard, or from Messages in the ☰ menu.',
  placement: 'left',
});

export const finishStep = (route: string): TourStep => ({
  id: 'finish',
  route,
  target: '.ehr-top-actions',
  title: "You're all set",
  body: 'That’s your workflow end to end. Replay this tour anytime from your profile menu — look for “Take a tour.”',
  placement: 'left',
});

// ── Nursing (nurse, midwife, triage/rooming nurse) — USER-JOURNEYS §5 ──────
// The standalone nurse station is retired: nurse-family roles now land on the
// same shared clinical workspace as doctors (/dashboard, rendered by
// NurseHomeView — see components/dashboards/NurseHomeView.tsx), so every step
// below is anchored to a route + selector that actually exists in that shell.
// Triage (/triage/[patientId]) and rooming (/rooming/[patientId]) both take a
// real patient id, so there is no generic route to script a click through —
// that step describes the flow narratively instead of inventing a selector.
// Same reasoning for MAR (/wards/mar/[admissionId]): reached per admission
// from the "Medications due" outstanding entry, not from a static control on
// the ward board.
