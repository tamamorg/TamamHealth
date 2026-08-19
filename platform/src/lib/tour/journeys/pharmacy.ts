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
    id: 'review-safety',
    route: '/dashboard/pharmacy',
    // The gates live inside a row's own expanded workflow popup, which only
    // exists once a specific order is opened — no static anchor exists before
    // that, so this stays narrative rather than pointing at an invented one.
    target: '',
    title: 'Dispensing safety gates',
    body: 'Open an order in the queue and Dispense checks, in order: enough stock for the full course, drug interactions against the patient’s other active meds, and — for controlled drugs — a witness picker that writes the two-signature register entry before stock moves.',
  },
  {
    id: 'inventory',
    route: '/pharmacy',
    target: '',
    title: 'Inventory at a glance',
    body: 'Live stock status — adequate, low, critical, or expired — across every medication, filterable by category from the same table the dispensing gate above checks against.',
  },
  {
    id: 'receive-stock',
    route: '/pharmacy',
    target: '[data-tour="pharmacy-receive-stock"]',
    placement: 'bottom',
    title: 'Receive stock with batch + expiry',
    body: 'Every delivery is logged against its batch number and expiry date. FEFO issuing means dispensing always draws from the earliest-expiring in-stock batch first.',
  },
  {
    id: 'reorder-export',
    route: '/pharmacy',
    target: '',
    title: 'Reorder and export',
    body: 'Switch to the Reorder tab for a printable purchase order covering everything at or below its reorder level, or download any tab’s rows as CSV from the toolbar.',
  },
  {
    id: 'stock-alerts',
    route: '/dashboard/pharmacy',
    target: '[data-tour="station-body"]',
    preClickSelector: '[data-tour="pharmacy-stock-alerts-toggle"]',
    placement: 'top',
    title: 'Stock alerts at a glance',
    body: 'Low, critical and expired lines surface here the moment they cross their reorder level — before a patient shows up needing the medicine that has already run out.',
  },
  {
    id: 'controlled',
    route: '/controlled-substances',
    target: '[data-tour="csub-record-movement"]',
    placement: 'bottom',
    title: 'Controlled-substance register',
    body: 'An append-only, two-signature register: intake, dispense, waste, reconciliation, transfer. Entries can never be edited or deleted — dispensing a scheduled drug from the queue writes here automatically.',
  },
  {
    id: 'analytics',
    route: '/dashboard/pharmacy',
    target: '[data-tour="station-body"]',
    preClickSelector: '[data-tour="pharmacy-analytics-toggle"]',
    placement: 'top',
    title: 'Dispensing & stock analytics',
    body: 'Queue depth and average wait right now, the top movers dispensed over the last 14 days, and which items are on track to run out soonest.',
  },
  searchStep('/dashboard/pharmacy'),
  messagingStep('/dashboard/pharmacy'),
  finishStep('/dashboard/pharmacy'),
];

// ── Radiology (radiologist) — §7.2 ─────────────────────────────────────────
