import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Radiology (radiologist) — §7.2 ─────────────────────────────────────────
export const RADIOLOGY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/radiology',
    target: '.ehr-care-greeting',
    title: 'Welcome to Imaging',
    body: 'Your workspace works like a doctor’s: patients with open imaging orders, your appointments, and what is outstanding — with the report written in the patient chart.',
    placement: 'bottom',
  },
  {
    id: 'book',
    route: '/dashboard/radiology',
    target: '.ehr-segmented-single button',
    placement: 'bottom',
    title: 'Book an appointment',
    body: 'Book a scan slot — an ultrasound, a CT, an MRI — into your own diary; the front desk confirms it.',
  },
  {
    id: 'worklist',
    route: '/dashboard/radiology',
    target: '.ehr-appointment-list',
    placement: 'right',
    title: 'Patients waiting for imaging',
    body: 'Every X-ray, ultrasound, CT, MRI, fluoroscopy and mammography order from a consultation lands here, urgent studies first. Open a row to go to the chart.',
  },
  {
    id: 'report-in-chart',
    route: '/dashboard/radiology',
    // The form lives in the patient chart's workspace, which only exists
    // once a chart is open — narrative rather than an invented selector.
    target: '',
    title: 'Report in the chart',
    body: 'In the chart, open Imaging report on the right-hand rail: Start study, attach images or a DICOM export (up to 5MB each, saved to the patient’s documents), enter findings and Submit report.',
  },
  {
    id: 'findings-safety',
    route: '/dashboard/radiology',
    target: '',
    title: 'Findings reach the clinician automatically',
    body: 'Submitting a report pages the ordering clinician directly, in addition to saving it to the chart — nothing to phone in or chase down.',
  },
  {
    id: 'outstanding',
    route: '/dashboard/radiology',
    target: '.ehr-outstanding-card',
    placement: 'left',
    title: 'What needs reading first',
    body: 'Urgent studies, studies to perform, studies awaiting a report, and what you reported today. Each entry opens the chart with the report form already up.',
  },
  searchStep('/dashboard/radiology'),
  messagingStep('/dashboard/radiology'),
  finishStep('/dashboard/radiology'),
];

// ── Nutrition (nutritionist) — §7.7 ────────────────────────────────────────
