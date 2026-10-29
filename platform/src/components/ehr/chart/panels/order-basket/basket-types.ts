/**
 * The order basket's unsigned orders (OpenMRS O3's model): a drug or test
 * order is built in the basket and nothing reaches the pharmacy or the bench
 * until the clinician presses "Sign and close". These are the drafts it holds.
 */

import type { FormularyDrug } from '@/lib/data/formulary';
import type { LabOrderPriority, OrderedTest } from '@/components/lab/order/lab-order-types';
import { todayIso } from '@/lib/date-utils';
import { estimateCourseQuantity } from '@/lib/pharmacy/course-quantity';

export type DurationUnit = 'days' | 'weeks' | 'months';

export interface DrugOrderDraft {
  id: string;
  kind: 'drug';
  drug: FormularyDrug;
  /** Free text dosage replaces dose / route / frequency with one sentence. */
  freeText: boolean;
  freeTextDosage: string;
  dose: string;
  doseUnit: string;
  route: string;
  /** A frequency code from FREQUENCIES ("BD"), which the quantity estimator reads. */
  frequency: string;
  patientInstructions: string;
  prn: boolean;
  prnReason: string;
  startDate: string;
  duration: string;
  durationUnit: DurationUnit;
  /** Empty until typed: the course quantity is estimated until then. */
  quantity: string;
  quantityUnit: string;
  refills: string;
  indication: string;
  /** The note this order was raised from, if any. */
  context?: BasketContext;
}

export interface TestOrderDraft {
  id: string;
  kind: 'test';
  test: OrderedTest;
  referenceNumber: string;
  priority: LabOrderPriority;
  instructions: string;
  /** The note this order was raised from, if any. */
  context?: BasketContext;
}

export type BasketOrder = DrugOrderDraft | TestOrderDraft;

/** What the basket was opened from, when that was a note: the note's visit,
 *  which the signed prescriptions are filed under, and the note itself, which
 *  records that orders were raised from it. */
export interface BasketContext {
  encounterId?: string;
  noteId?: string;
}

/** Which screen of the basket to open on. */
export type BasketView = 'basket' | 'drug' | 'lab';

/** A one-shot request to open the basket on a screen (a header button, the
 *  note editor). A new object each time, so the same screen can be asked for
 *  twice. */
export interface BasketRequest {
  view: BasketView;
}

export const ROUTES = [
  'Oral', 'Sublingual', 'Intravenous', 'Intramuscular', 'Subcutaneous', 'Topical',
  'Inhaled', 'Nasal', 'Rectal', 'Vaginal', 'Ophthalmic', 'Otic',
] as const;

/** Codes the pharmacy and the quantity estimator already read (OD 1 · BD 2 …). */
export const FREQUENCIES = ['OD', 'BD', 'TDS', 'QDS', 'Nocte', 'q4h', 'q6h', 'q8h', 'Weekly', 'STAT'] as const;

export const DOSE_UNITS = [
  'Tablet', 'Capsule', 'mg', 'g', 'mcg', 'ml', 'IU', 'Drop', 'Puff', 'Sachet', 'Suppository', 'Application',
] as const;

/** "Tablet / Injection" → "Tablet"; the unit a dose of this drug is counted in. */
export function defaultDoseUnit(drug: FormularyDrug): string {
  const form = (drug.form || '').split('/')[0].trim().toLowerCase();
  const match = DOSE_UNITS.find(unit => unit.toLowerCase() === form);
  if (match) return match;
  if (form.startsWith('injection') || form.startsWith('syrup') || form.startsWith('suspension')) return 'ml';
  return 'Tablet';
}

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function newDrugOrder(drug: FormularyDrug): DrugOrderDraft {
  const unit = defaultDoseUnit(drug);
  return {
    id: newId('rx'),
    kind: 'drug',
    drug,
    freeText: false,
    freeTextDosage: '',
    dose: '',
    doseUnit: unit,
    route: drug.form?.toLowerCase().startsWith('injection') ? 'Intravenous' : 'Oral',
    frequency: '',
    patientInstructions: '',
    prn: false,
    prnReason: '',
    startDate: todayIso(),
    duration: '',
    durationUnit: 'days',
    quantity: '',
    quantityUnit: unit,
    refills: '0',
    indication: '',
  };
}

export function newTestOrder(test: OrderedTest): TestOrderDraft {
  return { id: newId('lab'), kind: 'test', test, referenceNumber: '', priority: 'routine', instructions: '' };
}

/** "1 Tablet", "500 mg"; empty when no dose was entered. */
export function doseText(order: DrugOrderDraft): string {
  return order.dose.trim() ? `${order.dose.trim()} ${order.doseUnit}`.trim() : '';
}

/** "5 days". */
export function durationText(order: DrugOrderDraft): string {
  const n = order.duration.trim();
  if (!n) return '';
  const unit = order.durationUnit;
  return `${n} ${n === '1' ? unit.replace(/s$/, '') : unit}`;
}

/** The frequency as stored on the prescription: the code, with PRN after it. */
export function frequencyText(order: DrugOrderDraft): string {
  if (order.freeText) return order.freeTextDosage.trim();
  return [order.frequency, order.prn ? 'PRN' : ''].filter(Boolean).join(' ');
}

/** The quantity to dispense: the clinician's figure, or the full course. */
export function quantityFor(order: DrugOrderDraft): number {
  const typed = parseInt(order.quantity, 10);
  if (Number.isFinite(typed) && typed > 0) return typed;
  return estimateCourseQuantity({
    medication: order.drug.name,
    dose: doseText(order),
    frequency: frequencyText(order),
    duration: durationText(order),
  });
}

/** Why a drug order cannot go in the basket yet; empty when it can. */
export function drugOrderGaps(order: DrugOrderDraft): ('dose' | 'route' | 'frequency' | 'freeText' | 'prnReason')[] {
  if (order.freeText) return order.freeTextDosage.trim() ? [] : ['freeText'];
  const gaps: ('dose' | 'route' | 'frequency' | 'prnReason')[] = [];
  if (!order.dose.trim()) gaps.push('dose');
  if (!order.route) gaps.push('route');
  if (!order.frequency) gaps.push('frequency');
  if (order.prn && !order.prnReason.trim()) gaps.push('prnReason');
  return gaps;
}
