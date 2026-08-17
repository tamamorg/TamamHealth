import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Pharmacy (pharmacist) — §7.3–7.4 ───────────────────────────────────────
export const PHARMACY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/pharmacy',
    target: '.ehr-care-greeting',
    title: 'Welcome to the Pharmacy',
    body: 'Let’s walk the dispensing queue, the safety gates, and your inventory tools.',
    placement: 'bottom',
  },
  {
    id: 'queue',
    route: '/dashboard/pharmacy',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'The prescription queue',
    body: 'Prescriptions arrive from consultations in priority order — life-sustaining tiers first, immediate-urgency floats up.',
  },
  {
    id: 'dispense-gates',
    route: '/dashboard/pharmacy',
    target: '[data-tour="station-body"]',
    placement: 'top',
    title: 'Dispensing safety gates',
    body: 'Each dispense checks, in order: enough stock for the full course, drug interactions against the patient’s other active meds, and — for controlled drugs — a witness picker that writes the two-signature register entry before stock moves.',
  },
  {
    id: 'inventory',
    route: '/pharmacy',
    target: '',
    title: 'Inventory, reorder & expiry',
    body: 'Live stock status (adequate / low / critical / expired), receive stock with batch + expiry, FEFO expiry tracking, reorder quantities with a printable purchase order, and CSV export everywhere.',
  },
  {
    id: 'controlled',
    route: '/controlled-substances',
    target: '',
    title: 'Controlled-substance register',
    body: 'An append-only, two-signature register: intake, dispense, waste, reconciliation, transfer. Entries can never be edited or deleted — dispensing scheduled drugs writes here automatically.',
  },
  searchStep('/dashboard/pharmacy'),
  messagingStep('/dashboard/pharmacy'),
  finishStep('/dashboard/pharmacy'),
];

// ── Radiology (radiologist) — §7.2 ─────────────────────────────────────────
