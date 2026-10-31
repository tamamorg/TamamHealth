/**
 * The bench-side counterpart to the ordering wizard: what the lab's form asks
 * for at each stage of the diagnostics lifecycle (`LAB_ORDER_TRANSITIONS`).
 * Mapping lives here so the form, the rows and the queue all agree.
 */

import { toIsoDate, todayIso } from '@/lib/date-utils';
import type { LabOrderStatus } from '@/lib/clinical-flow/order-lifecycles';

/** What the next press does to an order at this stage. One label for the row,
 *  the chart list and the slider, so each names the same step. */
export function benchActionLabel(stage: LabOrderStatus): string {
  switch (stage) {
    case 'ordered':
    case 'rejected_needs_recollection': return 'labFlow.nextCollect';
    case 'specimen_collected':
    case 'received_at_lab':
    case 'in_process': return 'labFlow.nextResult';
    default: return 'labFlow.nextReport';
  }
}

/** What a row's dropdown offers at this stage. Nothing once it has resulted. */
export function benchActions(stage: LabOrderStatus, t: (key: string) => string): { value: string; label: string }[] {
  if (['resulted', 'reviewed_by_clinician', 'acted_upon', 'communicated_to_patient'].includes(stage)) return [];
  const next = { value: 'next', label: t(benchActionLabel(stage)) };
  return stage === 'specimen_collected' ? [next, { value: 'reject', label: t('labFlow.actionReject') }] : [next];
}

/** Requests from outside this facility get their report back from the lab. */
export const isOutsideRequest = (order: { requestSource?: string }) =>
  order.requestSource === 'external_facility' || order.requestSource === 'walk_in';

/** How far the order has got, as a step index — everything before it is done. */
export function completedThrough(stage: LabOrderStatus): number {
  const order: Record<LabOrderStatus, number> = {
    ordered: 0,
    rejected_needs_recollection: 0,
    specimen_collected: 1,
    received_at_lab: 2,
    in_process: 3,
    resulted: 4,
    reviewed_by_clinician: 5,
    acted_upon: 5,
    communicated_to_patient: 5,
  };
  return order[stage] ?? 0;
}

/** Containers a specimen can arrive in, by specimen type. */
export const SPECIMEN_CONTAINERS: Record<string, string[]> = {
  Blood: ['EDTA (purple top)', 'Plain / serum (red top)', 'Fluoride oxalate (grey top)', 'Citrate (blue top)', 'Heparin (green top)', 'Blood culture bottle'],
  Urine: ['Sterile universal container', 'Boric acid container', '24-hour collection bottle'],
  Stool: ['Sterile stool pot', 'Transport medium (Cary-Blair)'],
  Sputum: ['Sterile sputum pot'],
  Swab: ['Transport swab (Amies)', 'Dry swab'],
};

export const DEFAULT_CONTAINERS = ['Sterile universal container', 'Other'];

export const containersFor = (specimen: string): string[] =>
  SPECIMEN_CONTAINERS[specimen] || DEFAULT_CONTAINERS;

export const SPECIMEN_REJECTION_REASONS = [
  'Hemolyzed',
  'Clotted',
  'Insufficient quantity',
  'Wrong container',
  'Unlabeled specimen',
  'Leaking container',
  'Delayed transport',
  'Other',
];

/** Accession fallback for orders placed before accessions were stamped. */
export function fallbackAccessionNumber(order: { _id: string; accessionNumber?: string; orderedAt?: string }): string {
  if (order.accessionNumber) return order.accessionNumber;
  const ordered = new Date(order.orderedAt || Date.now());
  const day = Number.isNaN(ordered.getTime())
    ? todayIso().slice(2).replace(/-/g, '')
    : toIsoDate(ordered).slice(2).replace(/-/g, '');
  return `ACC-${day}-${order._id.replace(/^lab-/, '').slice(0, 5).toUpperCase()}`;
}
