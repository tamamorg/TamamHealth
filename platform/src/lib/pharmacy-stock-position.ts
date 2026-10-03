/**
 * Where a medicine stands on this facility's shelves, as the prescriber needs
 * to know it while writing the order.
 *
 * The prescribing dialog used to answer this with the first inventory line
 * whose name contained the drug's first word. That read "Amoxicillin" against
 * an Amoxicillin-Clavulanate line, looked at one batch instead of the shelf,
 * counted expired stock, and never compared the shelf to the quantity being
 * prescribed. This is the same question the pharmacist's counter asks at
 * dispensing (`getDispensableBatches`), answered with the same name matcher,
 * so the prescriber and the pharmacist cannot be told two different things.
 */
import type { PharmacyInventoryDoc } from './db-types';
import { medicationMatches } from './services/dispensing-service';
import { jubaDate } from './time-juba';

export type StockState =
  /** The facility keeps no inventory at all — nothing can be said either way. */
  | 'untracked'
  /** Inventory exists, and none of it is this medicine. */
  | 'not_stocked'
  /** Every batch on the shelf is past its expiry. */
  | 'expired'
  /** Carried, with nothing on hand. */
  | 'out'
  /** On hand, but less than this prescription asks for. */
  | 'short'
  /** Covers this prescription, at or below the reorder level. */
  | 'low'
  | 'ok';

export interface StockPosition {
  state: StockState;
  /** Dispensable units: in-date batches with stock, summed. */
  available: number;
  /** Units this prescription asks for. */
  requested: number;
  unit: string;
  reorderLevel: number;
  /** Earliest expiry among the dispensable batches. */
  soonestExpiry?: string;
  /** Batch number of that earliest-expiring batch. */
  soonestBatch?: string;
  /** Any matching line is a scheduled drug. */
  controlledSchedule?: PharmacyInventoryDoc['controlledSchedule'];
  requiresWitness: boolean;
}

// The unit must end the token: "5 gel" is not five grams.
const STRENGTH = /\d+(?:[./]\d+)*\s*(?:mg|mcg|g|ml|iu|%)(?![a-z])/i;

function strengthOf(name: string): string {
  return (STRENGTH.exec(name)?.[0] || '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Same product as the counter would pick, with one refinement: when both names
 * state a strength and the strengths differ, they are different lines. The
 * shared matcher drops strength on purpose (the formulary mostly omits it), so
 * without this a 250 mg shelf would answer for a 500 mg order.
 */
export function stockLineMatches(prescribed: string, stocked: string): boolean {
  if (!medicationMatches(prescribed, stocked)) return false;
  const a = strengthOf(prescribed);
  const b = strengthOf(stocked);
  return !a || !b || a === b;
}

export interface StockPositionOptions {
  /** Count only this facility's lines. A scope can span several hospitals. */
  facilityId?: string;
  /** Clinical day to judge expiry against. Defaults to today in Juba. */
  today?: string;
}

export function stockPositionFor(
  medication: string,
  inventory: PharmacyInventoryDoc[],
  quantity: number,
  options: StockPositionOptions = {},
): StockPosition {
  const today = options.today ?? jubaDate();
  const requested = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const shelf = options.facilityId
    ? inventory.filter(line => line.hospitalId === options.facilityId)
    : inventory;
  const lines = shelf.filter(line => stockLineMatches(medication, line.medicationName));

  const inDate = lines.filter(line => !line.expiryDate || line.expiryDate >= today);
  const dispensable = inDate
    .filter(line => (line.stockLevel || 0) > 0)
    // FEFO, as the counter allocates: undated batches last.
    .sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999'));
  const available = dispensable.reduce((sum, line) => sum + (line.stockLevel || 0), 0);
  const reorderLevel = lines.reduce((max, line) => Math.max(max, line.reorderLevel || 0), 0);
  const expiredWithStock = lines.some(line =>
    line.expiryDate && line.expiryDate < today && (line.stockLevel || 0) > 0);

  let state: StockState;
  if (shelf.length === 0) state = 'untracked';
  else if (lines.length === 0) state = 'not_stocked';
  else if (available <= 0) state = expiredWithStock ? 'expired' : 'out';
  else if (requested > available) state = 'short';
  else if (reorderLevel > 0 && available <= reorderLevel) state = 'low';
  else state = 'ok';

  return {
    state,
    available,
    requested,
    unit: (dispensable[0] || lines[0])?.unit || '',
    reorderLevel,
    soonestExpiry: dispensable[0]?.expiryDate || undefined,
    soonestBatch: dispensable[0]?.batchNumber || undefined,
    controlledSchedule: lines.find(line => line.controlledSchedule)?.controlledSchedule,
    requiresWitness: lines.some(line => line.requiresWitness),
  };
}

/** True when the on-site pharmacy cannot fill this prescription as written. */
export function cannotFillOnSite(position: StockPosition): boolean {
  return position.state === 'out'
    || position.state === 'expired'
    || position.state === 'short'
    || position.state === 'not_stocked';
}
