import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Nursing (nurse, midwife, triage/rooming nurse) — USER-JOURNEYS §5 ──────
// The standalone nurse station is retired: nurse-family roles now land on the
// same shared clinical workspace as doctors (/dashboard, rendered by
// NurseHomeView — see components/dashboards/NurseHomeView.tsx), so every step
// below is anchored to a route + selector that actually exists in that shell.
//
// Triage (/triage/[patientId]), rooming (/rooming/[patientId]) and the MAR
// (/wards/mar/[admissionId]) all take a real id, so the engine can't navigate
// to them directly — each is reached by a preceding step whose
// `preClickSelector` opens a real record (a queue-card row, or the ETAT
// button on an expanded worklist row), then a `route: '/x/[id]'` step rides
// along once the browser lands there. The outstanding rail's chip → row is
// two separate clicks (the row only exists in the DOM after its chip is
// clicked), so each of those pairs is two tour steps, not one.
//
// This means the meds-due and rooming-queue reveal/open steps target
// `.ehr-outstanding-chips`/`.ehr-queue-card` regardless of whether either
// queue is empty right now — both are live, data- and time-of-day-dependent
// (a dose is only "due" inside its actual scheduled window). When empty, the
// click finds nothing and the step degrades to a centred card instead of
// highlighting a row, same as any other unmet selector — never a hard error.
//
// Rooming is not in midwife's allowed routes (ICM scope has no ER-style
// intake) — the rooming-board step is silently dropped for midwife, same as
// the brief's own filtering rule, but its two preceding /dashboard steps
// (chip, row) are not, since their own `route` is the universally-allowed
// /dashboard. For midwife only, that row click will bounce off /rooming and
// back toward /dashboard rather than opening the record — a beat of visual
// noise, not a stuck tour (the next step's route is /dashboard too). Triage
// and MAR have no such gap: /triage and /wards are in all four roles' allow
// lists.
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
    id: 'rooming-queue',
    route: '/dashboard',
    target: '.ehr-outstanding-chips button:nth-child(3)',
    preClickSelector: '.ehr-outstanding-chips button:nth-child(3)',
    placement: 'left',
    title: 'Open the rooming queue',
    body: 'Everyone from check-in through mid-rooming sits here, longest wait first. Tap the “Rooming queue” chip to see who’s waiting.',
  },
  {
    id: 'rooming-continue',
    route: '/dashboard',
    target: '.ehr-queue-card',
    preClickSelector: '.ehr-queue-card',
    placement: 'top',
    title: 'Continue rooming',
    body: 'Tap a patient in the queue to open their rooming record.',
  },
  {
    id: 'rooming-board',
    route: '/rooming/[patientId]',
    target: '[data-tour="rooming-board"]',
    placement: 'top',
    title: 'Assign a room and take vitals',
    body: 'Mark them arrived, assign a bed or room, record rooming vitals, then mark ready — that’s what moves them onto the clinician’s worklist.',
  },
  {
    id: 'worklist-open',
    route: '/dashboard',
    target: '.ehr-appointment-row',
    preClickSelector: '.ehr-appointment-row',
    placement: 'top',
    title: 'Open a patient’s visit',
    body: 'Tap any row on your worklist to expand it — the chart, call, and triage actions all live in that expanded view.',
  },
  {
    id: 'start-triage',
    route: '/dashboard',
    target: 'button[title="Open the ETAT triage assessment"]',
    preClickSelector: 'button[title="Open the ETAT triage assessment"]',
    placement: 'bottom',
    title: 'Start (or review) triage',
    body: 'Anyone not yet assessed gets this button — it opens the ETAT form pinned to that one patient.',
  },
  {
    id: 'triage-form',
    route: '/triage/[patientId]',
    target: '[data-tour="triage-form"]',
    placement: 'top',
    title: 'The ETAT assessment',
    body: 'Airway, Breathing, Circulation, Consciousness, then vitals — RED / YELLOW / GREEN priority is calculated as you go. Save to hand the patient off to the right queue.',
  },
  {
    id: 'ward-board',
    route: '/wards',
    target: '[data-tour="ward-admissions"]',
    placement: 'top',
    title: 'The ward board',
    body: 'Your admitted patients, sorted by ward, with diagnosis and severity. Admit a new patient or discharge one from here; occupancy stats sit at the top. Each admission also has its own bedside medication record (the printable time-grid MAR) — reached per admission from the Medications due card on your dashboard.',
  },
  {
    id: 'meds-due',
    route: '/dashboard',
    target: '.ehr-outstanding-chips button:nth-child(1)',
    preClickSelector: '.ehr-outstanding-chips button:nth-child(1)',
    placement: 'left',
    title: 'Medications due',
    body: 'Doses due now or overdue across every admitted patient, worst first. Tap the “Medications due” chip to see them.',
  },
  {
    id: 'meds-open',
    route: '/dashboard',
    target: '.ehr-queue-card',
    preClickSelector: '.ehr-queue-card',
    placement: 'top',
    title: 'Open a bedside record',
    body: 'Tap a dose to jump straight to that patient’s MAR — the same grid whether it’s due, overdue, or already given.',
  },
  {
    id: 'mar-grid',
    route: '/wards/mar/[admissionId]',
    target: '[data-tour="mar-grid"]',
    placement: 'top',
    title: 'The medication administration record',
    body: 'One row per prescription, one column per scheduled time. Tap a cell to record given, missed, refused, or held — controlled substances ask for a witness.',
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
