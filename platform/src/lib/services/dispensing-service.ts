/**
 * Dispensing — the single transaction that moves medicine off the shelf.
 *
 * Before this service, dispensing was three independent client-side writes
 * (decrement stock → mark prescription dispensed → maybe log the controlled
 * substance). Any failure between them left the pharmacy in a state that
 * cannot be reconciled: stock gone with no dispense record, or a prescription
 * marked dispensed against stock that never moved. Worse, the controlled-drug
 * register was written by the UI, so any caller that skipped that branch
 * dispensed a Schedule II drug with no register entry at all.
 *
 * Everything now runs here, in one guarded sequence:
 *
 *   1. validate (clearance, quantity, witness) — nothing is written until
 *      every precondition holds, so the common failure costs no writes;
 *   2. plan a FEFO allocation across batches and refuse if stock is short;
 *   3. apply the batch decrements, remembering each one;
 *   4. write the controlled-substance register entry when the schedule
 *      requires it;
 *   5. update the prescription.
 *
 * PouchDB has no multi-document transaction, so atomicity is compensation-
 * based: a failure at step 4 or 5 rolls the applied decrements back (and, for
 * a register entry that already landed, appends a `reconciliation` movement —
 * the register is append-only, so a mistake is corrected by a counter-entry,
 * never by deletion). The invariant the ticket asks for holds either way:
 * you never end up with stock movement and no dispense record, or the reverse.
 */
import { pharmacyInventoryDB } from '../db';
import type {
  PharmacyInventoryDoc, PrescriptionDoc, DispenseAllocation, UserRole,
} from '../db-types';
import { findByType } from './db-query';
import { recordMovement } from './controlled-substance-service';
import { updatePrescription, effectivePrescriptionStatus } from './prescription-service';
import { getUserById } from './user-service';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { jubaDate } from '../time-juba';

export type DispenseErrorCode =
  | 'NOT_CLEARED'
  | 'BAD_QUANTITY'
  | 'STOCK_OUT'
  | 'INSUFFICIENT_STOCK'
  | 'WITNESS_REQUIRED'
  | 'WITNESS_INVALID'
  | 'AMBIGUOUS_MEDICATION'
  | 'PARTIAL_NOT_ALLOWED'
  | 'REGISTER_FAILED'
  | 'WRITE_FAILED'
  | 'NOT_AUTHORISED';

export class DispenseError extends Error {
  constructor(
    message: string,
    public readonly code: DispenseErrorCode,
    /** Stock actually on hand, for the "X available, Y needed" message. */
    public readonly available?: number,
  ) {
    super(message);
    this.name = 'DispenseError';
  }
}

export interface DispenseInput {
  prescription: PrescriptionDoc;
  /** Units to hand over. May be less than the prescribed course (partial fill). */
  quantity: number;
  dispenserId: string;
  dispenserName: string;
  /**
   * Trusted fallback role, used only when the directory has no account for
   * `dispenserId` at all (see the actor-authorization check below). Never
   * overrides a real account's role — a directory hit always wins, exactly
   * like the witness identity resolution later in this file.
   */
  dispenserRole?: UserRole;
  facilityId: string;
  facilityName?: string;
  orgId?: string;
  /** Required when any allocated batch is a controlled schedule. */
  witnessId?: string;
  witnessName?: string;
  /** Set when the pharmacist knowingly fills short of the full course. */
  allowPartial?: boolean;
  note?: string;
}

export interface DispenseResult {
  prescription: PrescriptionDoc;
  allocations: DispenseAllocation[];
  quantityDispensed: number;
  outcome: 'full' | 'partial';
  /** First register entry, kept for callers that show a single reference. */
  controlledLogId?: string;
  /** Every register entry this dispense wrote — one per controlled lot. */
  controlledLogIds?: string[];
}

/** Stages from which a dispense is legal — mirrors PRESCRIPTION_TRANSITIONS. */
const DISPENSABLE_STAGES = new Set(['cleared_for_dispensing']);

/** Roles allowed to actually move stock. Every UI surface that offers a
 *  dispense action is a courtesy in front of this — the real gate is here,
 *  so a hole in any one surface's role check cannot itself dispense a drug. */
const DISPENSING_ROLES: UserRole[] = ['pharmacist'];

/** Dose strengths ("500mg", "5mg/mL", "80/480mg", "10 IU") and pack forms. */
const STRENGTH_RE = /\b\d+(?:[./]\d+)*\s*(?:mg|mcg|g|ml|l|iu|units?|%)(?:\s*\/\s*\d*\s*(?:ml|l|mg|dose))?\b/gi;
const FORM_RE = /\b(?:injection|inj|tablets?|tabs?|capsules?|caps?|syrup|suspension|solution|cream|ointment|drops?|vials?|ampoules?|sachets?|powder|infusion|oral|iv|im)\b/gi;

/**
 * Compare a prescribed drug name to an inventory line.
 *
 * Prescriptions are written as the clinician says them ("Amoxicillin") while
 * stock is catalogued with strength and form ("Amoxicillin 500mg"), so an
 * exact-string match — what both the stock gate and the decrement used to
 * do — found nothing for most orders. The gate then silently passed and no
 * stock ever moved, which is precisely the failure this ticket is about.
 * Normalising both sides (drop strength, pack form, brand parenthetical and
 * punctuation) links the two without needing a catalogue migration.
 */
export function normalizeMedicationName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')   // brand name in parentheses
    .replace(STRENGTH_RE, ' ')
    .replace(FORM_RE, ' ')
    .replace(/[.,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokens that may separate a base drug name from a salt, hydrate or grade
 * without changing which medicine it is: "Amoxicillin" and "Amoxicillin
 * trihydrate" are the same product on the shelf.
 *
 * Deliberately excludes release-modifier tokens (xr, sr, er, la, mr, cr) and
 * anything naming a second active ingredient. Metformin XR is not Metformin,
 * and Amoxicillin-Clavulanate is not Amoxicillin.
 */
const SALT_QUALIFIERS = new Set([
  'trihydrate', 'dihydrate', 'monohydrate', 'anhydrous', 'hydrate',
  'sulfate', 'sulphate', 'hydrochloride', 'hcl', 'sodium', 'potassium',
  'calcium', 'magnesium', 'maleate', 'tartrate', 'citrate', 'phosphate',
  'succinate', 'besylate', 'mesylate', 'fumarate', 'acetate', 'nitrate',
  'base', 'usp', 'bp', 'ph', 'eur',
]);

function medicationTokens(name: string): string[] {
  return name.split(/[\s/+-]+/).filter(Boolean);
}

/**
 * Does a prescribed name refer to the same product as a stocked line?
 *
 * This used to be `a.includes(b) || b.includes(a)`, which is true for any
 * shared prefix — so a prescription for "Insulin" matched insulin glargine,
 * aspart and isophane alike, and "Amoxicillin" matched
 * "Amoxicillin-Clavulanate". FEFO then picked whichever expired first, which
 * is a route to handing over the wrong drug.
 *
 * Now the shorter name must be a leading token-for-token match of the longer,
 * and every extra token in the longer name must be a salt/grade qualifier.
 * The trade-off is a false stock-out when a catalogue line carries a
 * distinguishing token the prescription omits ("Metformin" vs stock only
 * catalogued as "Metformin XR"); the pharmacist sees "out of stock" and picks
 * the product explicitly, which is the safe direction to fail.
 */
export function medicationMatches(prescribed: string, stocked: string): boolean {
  const a = normalizeMedicationName(prescribed);
  const b = normalizeMedicationName(stocked);
  if (!a || !b) return false;
  if (a === b) return true;

  const at = medicationTokens(a);
  const bt = medicationTokens(b);
  const [shorter, longer] = at.length <= bt.length ? [at, bt] : [bt, at];
  if (shorter.length === 0) return false;

  for (let i = 0; i < shorter.length; i++) {
    if (longer[i] !== shorter[i]) return false;
  }
  return longer.slice(shorter.length).every(t => SALT_QUALIFIERS.has(t));
}

/**
 * Batches of one medication at one facility, oldest-expiry first.
 *
 * Expired batches are excluded rather than sorted last: dispensing expired
 * stock is never correct, so it must not be reachable by asking for a large
 * enough quantity. They stay in inventory (a physical count still has to find
 * them) but can only leave via a `waste` movement.
 */
export async function getDispensableBatches(
  medicationName: string,
  facilityId: string | undefined,
): Promise<PharmacyInventoryDoc[]> {
  const db = pharmacyInventoryDB();
  // Fetched by type (not by an exact medicationName selector) because the
  // match is normalised — see medicationMatches. Inventory is per-facility
  // and small, so the in-memory filter is not a concern.
  const rows = await findByType<PharmacyInventoryDoc>(db, 'pharmacy_inventory');
  const today = jubaDate();
  return rows
    .filter(r => medicationMatches(medicationName, r.medicationName))
    .filter(r => !facilityId || r.hospitalId === facilityId)
    .filter(r => (r.stockLevel || 0) > 0)
    .filter(r => !r.expiryDate || r.expiryDate >= today)
    .sort((a, b) => {
      // FEFO: earliest expiry leaves first. Undated batches go last — an
      // unknown expiry must not jump ahead of a batch known to expire soon.
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    });
}

export interface FefoPlan {
  allocations: Array<{ batch: PharmacyInventoryDoc; quantity: number }>;
  allocated: number;
  shortfall: number;
  available: number;
}

/**
 * Work out which batches would satisfy `quantity`, without writing anything.
 * Exposed so the UI can show the stock position (and the shortfall) before
 * the pharmacist commits.
 */
export function planFefoAllocation(
  batches: PharmacyInventoryDoc[],
  quantity: number,
): FefoPlan {
  const allocations: FefoPlan['allocations'] = [];
  const available = batches.reduce((sum, b) => sum + (b.stockLevel || 0), 0);
  let remaining = quantity;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.stockLevel || 0, remaining);
    if (take <= 0) continue;
    allocations.push({ batch, quantity: take });
    remaining -= take;
  }
  return {
    allocations,
    allocated: quantity - remaining,
    shortfall: Math.max(0, remaining),
    available,
  };
}

/**
 * Decrement one batch, retrying on revision conflict.
 *
 * Two pharmacists dispensing the same batch concurrently each read the same
 * stockLevel; PouchDB rejects the second write with a 409, and re-reading lets
 * the loser apply its decrement on top of the winner's instead of silently
 * overwriting it. The final read-check also refuses to take more than the
 * batch currently holds, so a concurrent dispense cannot push stock negative.
 */
async function applyBatchDecrement(
  inventoryId: string,
  quantity: number,
): Promise<DispenseAllocation> {
  const db = pharmacyInventoryDB();
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const batch = await db.get(inventoryId) as PharmacyInventoryDoc;
    const before = batch.stockLevel || 0;
    if (before < quantity) {
      throw new DispenseError(
        `Batch ${batch.batchNumber} now holds only ${before} ${batch.unit}; another dispense took the stock.`,
        'INSUFFICIENT_STOCK',
        before,
      );
    }
    const now = new Date().toISOString();
    const updated: PharmacyInventoryDoc = {
      ...batch,
      stockLevel: before - quantity,
      dispensedToday: (batch.dispensedToday || 0) + quantity,
      lastDispensed: now,
      updatedAt: now,
    };
    try {
      const resp = await db.put(updated);
      emitSyncEvent({
        resourceType: 'pharmacy_inventory',
        resourceId: updated._id,
        operation: 'update',
        resourceVersion: resp.rev,
        orgId: updated.orgId,
        hospitalId: updated.hospitalId,
      });
      return {
        inventoryId: updated._id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantity,
        beforeBalance: before,
        afterBalance: updated.stockLevel,
      };
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 409 && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new DispenseError('Could not reserve stock after repeated conflicts.', 'WRITE_FAILED');
}

/** Put stock back on a batch — the compensating write for a failed dispense. */
async function revertBatchDecrement(allocation: DispenseAllocation): Promise<void> {
  const db = pharmacyInventoryDB();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const batch = await db.get(allocation.inventoryId) as PharmacyInventoryDoc;
      const now = new Date().toISOString();
      const resp = await db.put({
        ...batch,
        stockLevel: (batch.stockLevel || 0) + allocation.quantity,
        dispensedToday: Math.max(0, (batch.dispensedToday || 0) - allocation.quantity),
        updatedAt: now,
      } as PharmacyInventoryDoc);
      emitSyncEvent({
        resourceType: 'pharmacy_inventory',
        resourceId: allocation.inventoryId,
        operation: 'update',
        resourceVersion: resp.rev,
        orgId: batch.orgId,
        hospitalId: batch.hospitalId,
      });
      return;
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 409 && attempt < 4) continue;
      // A rollback that itself fails is a reconciliation problem, not a
      // reason to hide the original error — record it and move on.
      await logAuditSafe('PHARMACY_ROLLBACK_FAILED', undefined, undefined,
        `Could not return ${allocation.quantity} to batch ${allocation.batchNumber} (${allocation.inventoryId}). Physical count required.`,
      ).catch(() => {});
      return;
    }
  }
}

/** A register movement that actually landed, with what it was written against. */
interface WrittenRegisterEntry {
  logId: string;
  batch: PharmacyInventoryDoc;
  allocation: DispenseAllocation;
}

/**
 * Counter-entry register movements that landed for a dispense that then failed.
 *
 * The controlled-substance register is append-only: a mistake is corrected by a
 * `reconciliation` movement in the opposite direction, never by deleting the
 * original, so an inspector sees both the error and its correction. One
 * counter-entry per original entry, each quoting that lot's own balance.
 *
 * Best-effort by design — the caller is already unwinding a failure, and a
 * register that rejects the reversal must not mask the original error. Failures
 * are pushed to the audit log for manual reconciliation instead.
 */
async function reverseControlledEntries(
  written: WrittenRegisterEntry[],
  ctx: {
    rx: PrescriptionDoc;
    input: DispenseInput;
    witness: { id: string; name: string };
    reason: string;
  },
): Promise<void> {
  for (const { logId, batch, allocation } of written) {
    try {
      await recordMovement({
        inventoryId: batch._id,
        medicationName: batch.medicationName,
        schedule: batch.controlledSchedule || 'II',
        movement: 'reconciliation',
        quantity: allocation.quantity,
        unit: batch.unit,
        // The balance with this dispense's units still out of the lot — the
        // state the counter-entry is correcting from.
        beforeBalance: allocation.afterBalance,
        prescriptionId: ctx.rx._id,
        operatorId: ctx.input.dispenserId,
        operatorName: ctx.input.dispenserName,
        witnessId: ctx.witness.id,
        witnessName: ctx.witness.name,
        reason: `Reversal of ${logId} — ${ctx.reason}`,
        facilityId: ctx.input.facilityId,
        facilityName: ctx.input.facilityName || '',
        orgId: ctx.input.orgId,
      });
    } catch {
      await logAuditSafe('CONTROLLED_REVERSAL_FAILED', ctx.input.dispenserId, ctx.input.dispenserName,
        `Could not counter-entry register movement ${logId} for batch ${batch.batchNumber} `
        + `(${allocation.quantity} ${batch.unit}). Manual register reconciliation required.`,
      ).catch(() => {});
    }
  }
}

/**
 * Dispense a prescription: stock gate → FEFO decrement → controlled-substance
 * register → prescription update, with rollback of anything already applied
 * if a later step fails.
 */
export async function dispenseMedication(input: DispenseInput): Promise<DispenseResult> {
  const { prescription: rx, quantity } = input;

  // ── 1. Validate. Nothing is written before every check passes. ──
  //
  // Who is dispensing, resolved directory-first — mirrors the witness
  // resolution further down ("authoritative name, not the caller's string").
  // Every UI gate that offers a dispense action (the pharmacy queue, the
  // clinician dashboard's dispense modal, the API route) is a courtesy; this
  // is the real check, so a hole in any one of them cannot itself move stock.
  // `input.dispenserRole` is trusted ONLY when the directory has no record
  // at all for `dispenserId` — a real account's directory role always wins,
  // so a caller cannot claim a different role for an account that exists.
  const dispenserDoc = await getUserById(input.dispenserId);
  let dispenserRole: UserRole | undefined;
  if (dispenserDoc) {
    if (dispenserDoc.isActive === false) {
      throw new DispenseError(
        'The dispensing staff member account is inactive.',
        'NOT_AUTHORISED',
      );
    }
    dispenserRole = dispenserDoc.role;
  } else {
    dispenserRole = input.dispenserRole;
  }
  if (!dispenserRole || !DISPENSING_ROLES.includes(dispenserRole)) {
    throw new DispenseError(
      'Only a pharmacist may dispense medication.',
      'NOT_AUTHORISED',
    );
  }

  // Legacy prescriptions carry no `orderStatus`. The gate used to read the raw
  // field as `if (stage && !DISPENSABLE_STAGES.has(stage))`, so an absent value
  // skipped the check completely and an uncleared order could be dispensed
  // straight out of the queue. effectivePrescriptionStatus defaults those docs
  // to `received_in_pharmacy_queue` — not cleared — which is the safe direction.
  const stage = effectivePrescriptionStatus(rx);
  if (!DISPENSABLE_STAGES.has(stage)) {
    throw new DispenseError(
      'This order must be reviewed and cleared before it can be dispensed.',
      'NOT_CLEARED',
    );
  }
  // Belt-and-suspenders on top of the stage check above: a discontinued order
  // must never be dispensable, independent of whatever effectivePrescriptionStatus
  // resolves `orderStatus` to. Checked explicitly rather than trusted to the
  // stage function alone, since a stopped drug reaching a patient is the
  // failure this gate exists to prevent.
  if (rx.status === 'discontinued') {
    throw new DispenseError(
      'This medication was discontinued and can no longer be dispensed.',
      'NOT_CLEARED',
    );
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new DispenseError('Dispense quantity must be greater than zero.', 'BAD_QUANTITY');
  }

  // Completeness is cumulative, not per-visit: a patient who collected 10 of 21
  // last week and 11 today has the full course. Computed here, before any
  // write, so an unintended short fill costs nothing.
  const requested = rx.quantityToDispense || quantity;
  const totalDispensed = (rx.quantityDispensed || 0) + quantity;
  const outcome: 'full' | 'partial' = totalDispensed < requested ? 'partial' : 'full';

  const batches = await getDispensableBatches(rx.medication, input.facilityId);
  if (batches.length === 0) {
    throw new DispenseError(
      `${rx.medication} is out of stock at this facility.`,
      'STOCK_OUT',
      0,
    );
  }

  // Defence in depth behind medicationMatches: if the order still resolves to
  // more than one distinct product, FEFO would allocate by expiry date across
  // different medicines. Refuse and make the choice explicit rather than let
  // the shelf decide which drug the patient gets.
  const distinctProducts = [...new Set(batches.map(b => normalizeMedicationName(b.medicationName)))];
  if (distinctProducts.length > 1) {
    throw new DispenseError(
      `"${rx.medication}" matches ${distinctProducts.length} different products in stock `
      + `(${distinctProducts.join(', ')}). Re-prescribe naming the exact product.`,
      'AMBIGUOUS_MEDICATION',
    );
  }

  const plan = planFefoAllocation(batches, quantity);
  if (plan.shortfall > 0) {
    throw new DispenseError(
      `Insufficient stock: ${plan.available} available, ${quantity} requested.`,
      'INSUFFICIENT_STOCK',
      plan.available,
    );
  }

  // A controlled schedule on ANY allocated batch forces the two-signature
  // path — checked before the first write so a missing witness costs nothing.
  const controlledAllocations = plan.allocations
    .filter(a => a.batch.controlledSchedule || a.batch.requiresWitness);
  const controlledBatch = controlledAllocations[0]?.batch;

  /** Verified witness identity — authoritative name, not the caller's string. */
  let witness: { id: string; name: string } | undefined;

  if (controlledBatch) {
    if (!input.witnessId || !input.witnessName) {
      throw new DispenseError(
        `${rx.medication} is a controlled substance — a witnessing staff member is required.`,
        'WITNESS_REQUIRED',
      );
    }
    if (input.witnessId === input.dispenserId) {
      throw new DispenseError(
        'Operator and witness must be two different staff members.',
        'WITNESS_REQUIRED',
      );
    }

    // The witness is the second signature on a Schedule II movement, so it has
    // to be a real, active member of staff at this facility. Previously both
    // `witnessId` and `witnessName` were free-form strings that no layer ever
    // checked, so one pharmacist could satisfy the two-signature control alone
    // by inventing a colleague — precisely the diversion the register exists
    // to make impossible. Verified before any stock moves.
    const witnessDoc = await getUserById(input.witnessId);
    if (!witnessDoc || witnessDoc.isActive === false) {
      throw new DispenseError(
        'The witnessing staff member could not be verified. Select an active member of staff.',
        'WITNESS_INVALID',
      );
    }
    if (input.facilityId && witnessDoc.hospitalId && witnessDoc.hospitalId !== input.facilityId) {
      throw new DispenseError(
        'The witness must be staff at the dispensing facility.',
        'WITNESS_INVALID',
      );
    }
    if (input.orgId && witnessDoc.orgId && witnessDoc.orgId !== input.orgId) {
      throw new DispenseError(
        'The witness must belong to the same organisation.',
        'WITNESS_INVALID',
      );
    }
    // Register the name on record, so a mistyped or spoofed display name
    // cannot end up as the signature in an append-only register.
    witness = { id: witnessDoc._id, name: witnessDoc.name };
  }

  // Last of the pre-write checks, deliberately: a short fill is a confirmation
  // prompt, not a hard error, so every genuine blocker (not cleared, no stock,
  // ambiguous product, unverifiable witness) is reported first rather than
  // being masked by "confirm a partial fill".
  //
  // `allowPartial` was previously declared and never read, so a caller passing
  // `false` still got a silent short fill. The balance stays owed to the
  // patient, so dispensing less than the course has to be asked for.
  if (outcome === 'partial' && !input.allowPartial) {
    throw new DispenseError(
      `This fills ${totalDispensed} of ${requested} ${rx.medication}. `
      + 'Confirm a partial fill to dispense less than the prescribed course.',
      'PARTIAL_NOT_ALLOWED',
    );
  }

  // ── 2. Apply the batch decrements, remembering each for rollback. ──
  const applied: DispenseAllocation[] = [];
  const rollback = async () => {
    for (const a of applied) await revertBatchDecrement(a);
  };

  try {
    for (const { batch, quantity: take } of plan.allocations) {
      applied.push(await applyBatchDecrement(batch._id, take));
    }
  } catch (err) {
    await rollback();
    throw err;
  }

  // ── 3. Controlled-substance register — one entry per controlled batch. ──
  //
  // A register entry is a per-lot record: it says "this many units left THIS
  // batch, witnessed by these two people". FEFO routinely spans lots, so a
  // single entry carrying the whole dispense quantity against the first
  // controlled batch (what this used to do) left the second lot's stock
  // decremented with no register movement at all, and overstated the first.
  // Neither lot could then be reconciled against a physical count.
  const written: WrittenRegisterEntry[] = [];
  if (controlledAllocations.length > 0) {
    try {
      for (const { batch } of controlledAllocations) {
        // Use the applied allocation, not the plan: it carries the balance
        // actually observed at decrement time, which is what the register has
        // to reconcile against after a concurrent dispense forced a re-read.
        const appliedForBatch = applied.find(a => a.inventoryId === batch._id);
        if (!appliedForBatch) continue;
        const entry = await recordMovement({
          inventoryId: batch._id,
          medicationName: batch.medicationName,
          schedule: batch.controlledSchedule || 'II',
          movement: 'dispense',
          quantity: appliedForBatch.quantity,
          unit: batch.unit,
          beforeBalance: appliedForBatch.beforeBalance,
          patientId: rx.patientId,
          patientName: rx.patientName,
          prescriptionId: rx._id,
          operatorId: input.dispenserId,
          operatorName: input.dispenserName,
          witnessId: witness!.id,
          witnessName: witness!.name,
          reason: input.note,
          facilityId: input.facilityId,
          facilityName: input.facilityName || '',
          orgId: input.orgId,
        });
        written.push({ logId: entry._id, batch, allocation: appliedForBatch });
      }
    } catch (err) {
      // Counter-entry anything already written before returning the stock —
      // the register is append-only, so a partial run is corrected by
      // reversal, never by deleting the entries that landed.
      await reverseControlledEntries(written, {
        rx, input, witness: witness!,
        reason: 'Reversal — a later register entry in the same dispense failed.',
      });
      await rollback();
      throw new DispenseError(
        err instanceof Error ? err.message : 'Controlled-substance register entry failed.',
        'REGISTER_FAILED',
      );
    }
  }
  const controlledLogIds = written.map(w => w.logId);
  const controlledLogId = controlledLogIds[0];

  // ── 4. Update the prescription. `requested`, `totalDispensed` and `outcome`
  // were settled during validation, before any stock moved. ──
  const now = new Date().toISOString();

  let updated: PrescriptionDoc | null = null;
  try {
    updated = await updatePrescription(rx._id, {
      // A partial fill leaves the order live so the balance can still be
      // collected; only a full fill closes it.
      status: outcome === 'full' ? 'dispensed' : 'pending',
      orderStatus: outcome === 'full' ? 'dispensed' : 'stockout_partial_referred',
      dispensedAt: now,
      quantityDispensed: totalDispensed,
      dispenseAllocations: [...(rx.dispenseAllocations || []), ...applied],
      dispensedBy: input.dispenserId,
      dispensedByName: input.dispenserName,
      dispenseOutcome: outcome,
      ...(input.note ? { dispenseNote: input.note } : {}),
      ...(controlledLogId ? { controlledLogId } : {}),
    });
  } catch {
    updated = null;
  }

  if (!updated) {
    // Counter-entry every register movement this dispense wrote, then return
    // the stock. Order matters: the reversal quotes the balance as it stood
    // with the stock still out, so it must run before the decrements are undone.
    if (written.length > 0 && witness) {
      await reverseControlledEntries(written, {
        rx, input, witness,
        reason: 'Reversal — dispense record could not be written.',
      });
    }
    await rollback();
    throw new DispenseError(
      'Could not record the dispense; stock has been returned. Please retry.',
      'WRITE_FAILED',
    );
  }

  await logAuditSafe('PRESCRIPTION_DISPENSED', input.dispenserId, input.dispenserName,
    `Dispensed ${quantity} ${controlledBatch?.unit || plan.allocations[0]?.batch.unit || 'unit(s)'} of ${rx.medication} to ${rx.patientName} `
    + `from batch(es) ${applied.map(a => a.batchNumber).join(', ')} (Rx: ${rx._id})`
    + (outcome === 'partial' ? ` — PARTIAL fill, ${requested - totalDispensed} outstanding` : ''),
  );

  return {
    prescription: updated,
    allocations: applied,
    quantityDispensed: quantity,
    outcome,
    controlledLogId,
    ...(controlledLogIds.length > 0 ? { controlledLogIds } : {}),
  };
}

/**
 * Resolve a prescriber's directory id from the free-text `prescribedBy` name
 * on the order, so a clarification/stock-out task lands in THEIR task list
 * (`getTasks(userId)` joins on the user's `_id`). PrescriptionDoc carries no
 * prescriber id, only the display name typed at order time — mirrors
 * lab-service's `resolveOrderingClinicianId`, which solves the identical
 * problem for lab orders. An ambiguous or unmatched name falls back to the
 * name itself: invisible to the task list, but at least traceable in the
 * dispense note and audit log.
 */
async function resolvePrescriberId(prescribedBy: string, orgId?: string): Promise<string> {
  const wanted = (prescribedBy || '').trim().toLowerCase();
  if (!wanted) return prescribedBy;
  try {
    const { getAllUsers } = await import('./user-service');
    const users = await getAllUsers();
    // Constrained to the prescription's own org: the local directory holds
    // every tenant's users, and an unconstrained unique-name match could
    // deliver this PHI-bearing task to a same-named clinician elsewhere.
    const matches = users.filter(u =>
      (u.name || '').trim().toLowerCase() === wanted &&
      (!orgId || !u.orgId || u.orgId === orgId));
    if (matches.length === 1) return matches[0]._id;
  } catch {
    // Directory unavailable — fall through to the name.
  }
  return prescribedBy;
}

/**
 * Put a task on the prescriber's list when their order stalls at the
 * pharmacy — a clarification request or a stock-out both need the prescriber
 * to act (clarify the order, or substitute the medication), and until now
 * neither reached them: `recordUnfilled` parked the prescription at
 * `held_awaiting_clarification` / `stockout_partial_referred` and notified
 * nobody, so the medicine just stalled silently.
 *
 * Mirrors lab-service's `raiseCriticalResultTask`: best-effort, because the
 * dispense note is already durably written and a notification failure must
 * not roll that back.
 */
async function raisePharmacyTask(
  rx: PrescriptionDoc,
  reason: 'stock_out' | 'clarification_requested',
  note: string,
): Promise<void> {
  try {
    if (!rx.prescribedBy) return; // No one to notify — the pharmacy queue still shows it.
    const { createTask } = await import('./clinician-task-service');
    const title = reason === 'clarification_requested'
      ? `Pharmacy needs clarification: ${rx.medication}`
      : `Rx unavailable (stock-out): ${rx.medication}`;
    await createTask({
      userId: await resolvePrescriberId(rx.prescribedBy, rx.orgId),
      userName: rx.prescribedBy,
      title,
      description: `${rx.patientName} — ${note}`,
      priority: 'high',
      patientId: rx.patientId,
      patientName: rx.patientName,
      hospitalId: rx.hospitalId,
      orgId: rx.orgId,
    });
  } catch (err) {
    console.warn('[dispensing] could not raise prescriber task (dispense note was saved):', err);
  }
}

/**
 * Record that a prescription cannot be filled — no stock at all, or the
 * pharmacist needs the prescriber to clarify. Both leave the order active so
 * it stays on someone's list rather than disappearing, and both now put a
 * task on the prescriber's own list so the stall actually reaches them.
 */
export async function recordUnfilled(
  rx: PrescriptionDoc,
  reason: 'stock_out' | 'clarification_requested',
  note: string,
  actor: { id: string; name: string },
): Promise<PrescriptionDoc | null> {
  const updated = await updatePrescription(rx._id, {
    orderStatus: reason === 'stock_out' ? 'stockout_partial_referred' : 'held_awaiting_clarification',
    status: 'pending',
    dispenseOutcome: reason,
    dispenseNote: note,
  });
  if (updated) {
    await logAuditSafe(
      reason === 'stock_out' ? 'PRESCRIPTION_STOCKOUT' : 'PRESCRIPTION_CLARIFICATION',
      actor.id, actor.name,
      `${rx.medication} for ${rx.patientName} (Rx: ${rx._id}): ${note}`,
    );
    await raisePharmacyTask(rx, reason, note);
  }
  return updated;
}
