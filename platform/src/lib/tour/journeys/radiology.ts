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
    id: 'study',
    route: '/dashboard/radiology',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Work a study',
    body: 'Open a study → attach images or DICOM files (they save to the patient’s documents, so the ordering clinician sees them) → enter findings → Submit report. Completing returns the findings to the chart.',
  },
  {
    id: 'panels',
    route: '/dashboard/radiology',
    target: '[data-tour="station-body"]',
    placement: 'top',
    title: 'Your analytics',
    body: 'Modality breakdown, body regions, completion rate, and average turnaround time — at a glance.',
  },
  searchStep('/dashboard/radiology'),
  messagingStep('/dashboard/radiology'),
  finishStep('/dashboard/radiology'),
];

// ── Nutrition (nutritionist) — §7.7 ────────────────────────────────────────
