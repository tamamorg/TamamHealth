import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Radiology (radiologist) — §7.2 ─────────────────────────────────────────
export const RADIOLOGY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/radiology',
    target: '.ehr-care-greeting',
    title: 'Welcome to Imaging',
    body: 'Imaging orders from consultations land on this worklist automatically.',
    placement: 'bottom',
  },
  {
    id: 'lanes',
    route: '/dashboard/radiology',
    target: '[data-tour="station-tabs"]',
    placement: 'bottom',
    title: 'Pending → In Progress → Complete',
    body: 'Every study lands Pending, moves to In Progress once you start acquiring images, and Complete once the report is submitted — the same three-lane shape as every worklist in the app.',
  },
  {
    id: 'study',
    route: '/dashboard/radiology',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Work a study',
    body: 'Open a study → attach images or DICOM files (they save to the patient’s documents, so the ordering clinician sees them) → enter findings → Submit report. Completing returns the findings to the chart.',
  },
  {
    id: 'filter',
    route: '/dashboard/radiology',
    target: '[data-tour="rail-search"]',
    placement: 'bottom',
    title: 'Find a study fast',
    body: 'Filter the active lane by patient name, modality, or body part — useful once the worklist fills up mid-shift.',
  },
  {
    id: 'attach-images',
    route: '/dashboard/radiology',
    // The attach control lives inside a study's own expanded card, which only
    // exists once a specific study is opened — narrative rather than an
    // invented static selector.
    target: '',
    title: 'Attach the images',
    body: 'Upload JPEG/PNG or a DICOM export (up to 5MB each) straight from a study’s card. They save to the patient’s chart under Radiology immediately — no separate upload step for the clinician to wait on.',
  },
  {
    id: 'findings-safety',
    route: '/dashboard/radiology',
    target: '',
    title: 'Findings reach the clinician automatically',
    body: 'Submitting a report pages the ordering clinician directly, in addition to saving it to the chart — nothing to phone in or chase down.',
  },
  {
    id: 'panels',
    route: '/dashboard/radiology',
    target: '[data-tour="station-body"]',
    // station-body only renders once one of the header toggles opens a panel
    // (it's empty — and absent from the DOM — by default), so the toggle
    // itself is clicked first to reveal what this step is describing.
    preClickSelector: '[data-tour="radiology-modality-toggle"]',
    placement: 'top',
    title: 'Your analytics',
    body: 'Modality breakdown, body regions, completion rate, and average turnaround time — at a glance.',
  },
  {
    id: 'priority',
    route: '/dashboard/radiology',
    target: '[data-tour="side-cards"]',
    placement: 'left',
    title: 'Urgent and emergency studies',
    body: 'The right rail keeps a live count of urgent/emergency orders alongside your X-ray and ultrasound volumes, so you always know what needs reading first.',
  },
  searchStep('/dashboard/radiology'),
  messagingStep('/dashboard/radiology'),
  finishStep('/dashboard/radiology'),
];

// ── Nutrition (nutritionist) — §7.7 ────────────────────────────────────────
