import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

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
export const NURSE_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard',
    target: '.ehr-care-greeting',
    title: 'Welcome to your clinical workspace',
    body: 'Let’s walk your shift end to end: your worklist, triage and rooming, the ward board, medication rounds, and handoff. Use Back and Next, or skip anytime.',
    placement: 'bottom',
  },
  {
    id: 'worklist',
    route: '/dashboard',
    target: '.ehr-appointment-list',
    title: 'Your worklist',
    body: 'Today’s ward roster and anyone still moving through rooming, in one list. Click a row to open that patient’s chart.',
    placement: 'top',
  },
  {
    id: 'dash-outstanding',
    route: '/dashboard',
    target: '.ehr-outstanding-card',
    title: 'Outstanding items',
    body: 'Medications due, handoffs waiting on your acknowledgement, the rooming queue, and follow-ups due — each opens straight to the patient or the tool that clears it.',
    placement: 'left',
  },
  {
    id: 'triage-rooming',
    route: '/dashboard',
    target: '',
    title: 'Triage and rooming',
    body: 'New arrivals show up in the Rooming queue on the outstanding rail. A patient who hasn’t been triaged yet opens straight into Triage — ETAT ABCC (Airway, Breathing, Circulation, Consciousness) and vitals, with RED / YELLOW / GREEN priority calculated automatically. Once triaged, “Continue rooming” walks them through room assignment and rooming vitals until they’re marked ready — that’s what moves them onto the clinician’s worklist.',
  },
  {
    id: 'ward-board',
    route: '/wards',
    target: '',
    title: 'The ward board',
    body: 'Your admitted patients, sorted by ward, with diagnosis and severity. Admit a new patient or discharge one from here; occupancy stats sit at the top. Each admission also has its own bedside medication record (the printable time-grid MAR) — reached per admission from the Medications due card on your dashboard.',
  },
  {
    id: 'handoff',
    route: '/wards/handoff',
    target: '[data-tour="handoff-sbar"]',
    placement: 'top',
    title: 'Shift handoff',
    body: 'The shift auto-detects (day/evening/night). Write a per-patient SBAR for your critical patients, check the shift KPIs, then Sign off — the oncoming nurse acknowledges your handoff from here too.',
  },
  {
    id: 'anc',
    route: '/anc',
    target: '',
    title: 'Antenatal care',
    body: 'Mothers grouped with latest visit and risk level. A visit captures gestational age, BP, fundal height, fetal heart rate, screens, and the next-visit date — feeding MCH analytics and DHIS2.',
  },
  {
    id: 'immunizations',
    route: '/immunizations',
    target: '',
    title: 'Immunizations & defaulters',
    body: 'Record doses against each child’s schedule, and work the Defaulters tab — overdue doses can be recalled by SMS to the caregiver, per row or in bulk.',
  },
  searchStep('/dashboard'),
  messagingStep('/dashboard'),
  finishStep('/dashboard'),
];

// ── Laboratory (lab_tech) — §7.1 ───────────────────────────────────────────
