/**
 * The bench-side counterpart to the ordering wizard: the steps a lab
 * technician walks an order through, from the requisition that arrived to the
 * report that goes back.
 *
 * These are not new states — they are a view of the existing diagnostics
 * lifecycle (`LAB_ORDER_TRANSITIONS`), grouped into the six things a
 * technician actually does. Mapping lives here so the panel, the stepper and
 * the queue all agree on "which step is this order on".
 */

import { toIsoDate, todayIso } from '@/lib/date-utils';
import type { LabOrderStatus } from '@/lib/clinical-flow/order-lifecycles';

export type LabWorkflowStepKey = 'order' | 'collect' | 'receive' | 'process' | 'result' | 'report';

export const LAB_WORKFLOW_STEPS: LabWorkflowStepKey[] = [
  'order', 'collect', 'receive', 'process', 'result', 'report',
];

export const LAB_WORKFLOW_STEP_LABEL: Record<LabWorkflowStepKey, string> = {
  order: 'labFlow.stepOrder',
  collect: 'labFlow.stepCollect',
  receive: 'labFlow.stepReceive',
  process: 'labFlow.stepProcess',
  result: 'labFlow.stepResult',
  report: 'labFlow.stepReport',
};

/**
 * The step a given lifecycle stage is waiting on — i.e. where the technician
 * picks the order up. A rejected specimen goes back to Collect, which is the
 * whole point of the rejection: someone has to draw it again.
 */
export function stepForStage(stage: LabOrderStatus): LabWorkflowStepKey {
  switch (stage) {
    case 'ordered': return 'collect';
    case 'specimen_collected': return 'receive';
    case 'rejected_needs_recollection': return 'collect';
    case 'received_at_lab': return 'process';
    case 'in_process': return 'result';
    default: return 'report';
  }
}

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
