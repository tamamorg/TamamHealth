/**
 * Clinician-facing superbill / fee-ticket (P2.3).
 *
 * Centricity's checkout has the provider review the visit's charges (the "fee
 * ticket") before the patient leaves: services rendered, their prices, and an
 * ABN acknowledgement for anything the payer won't cover. This service builds a
 * priced PREVIEW (no persistence) so the clinician can see and confirm the
 * charges, then posts them through the existing billing path and records each
 * ABN acknowledgement as a chart directive (reusing P2.1).
 */
import type { ChargeCategory } from '../db-types-billing';
import type { DataScope } from './data-scope';
import {
  getActiveFees, priceFromFees, chargeForServices,
  type ChargeContext, type ChargeLineRequest,
} from './fee-schedule-service';
import { addDirective } from './directive-service';
import { logAuditSafe } from './audit-service';

export interface SuperbillSelection {
  category: ChargeCategory;
  serviceCode?: string;
  description?: string;
  quantity?: number;
  /** Explicit price override; otherwise looked up from the fee schedule. */
  unitPrice?: number;
  /**
   * Patient advised this service is not covered by their scheme and accepts
   * responsibility (ABN). Recorded as a chart directive on post.
   */
  nonCovered?: boolean;
}

export interface SuperbillLine {
  category: ChargeCategory;
  serviceCode?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  nonCovered: boolean;
  /** True when no catalog price could be resolved (line can't be posted). */
  unpriced: boolean;
}

export interface SuperbillPreview {
  lines: SuperbillLine[];
  total: number;
  coveredTotal: number;
  nonCoveredTotal: number;
  /** Lines that have no resolvable price — surfaced so the clinician can fix them. */
  unpricedCount: number;
  currency: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Price a set of proposed services from the fee schedule WITHOUT persisting,
 * so the clinician can review the fee ticket before confirming checkout.
 */
export async function buildSuperbillPreview(
  selections: SuperbillSelection[],
  scope?: DataScope,
  currency = 'SSP',
): Promise<SuperbillPreview> {
  const lines: SuperbillLine[] = [];
  // One catalog read for the whole preview. Previously every line called
  // priceFor(), repeating the same PouchDB/CouchDB scan N times.
  const needsCatalog = selections.some(selection => selection.unitPrice == null);
  const fees = needsCatalog ? await getActiveFees(scope) : [];
  for (const sel of selections) {
    const quantity = sel.quantity ?? 1;
    let unitPrice = sel.unitPrice;
    let description = sel.description;
    if (unitPrice == null) {
      const fee = priceFromFees(fees, sel.category, sel.serviceCode);
      if (fee) {
        unitPrice = fee.unitPrice;
        description = description || fee.serviceName;
      }
    }
    const unpriced = unitPrice == null;
    const price = unitPrice ?? 0;
    lines.push({
      category: sel.category,
      serviceCode: sel.serviceCode,
      description: description || sel.category,
      quantity,
      unitPrice: price,
      totalPrice: round2(quantity * price),
      nonCovered: !!sel.nonCovered,
      unpriced,
    });
  }
  const priced = lines.filter((l) => !l.unpriced);
  const total = round2(priced.reduce((s, l) => s + l.totalPrice, 0));
  const nonCoveredTotal = round2(priced.filter((l) => l.nonCovered).reduce((s, l) => s + l.totalPrice, 0));
  return {
    lines,
    total,
    coveredTotal: round2(total - nonCoveredTotal),
    nonCoveredTotal,
    unpricedCount: lines.filter((l) => l.unpriced).length,
    currency,
  };
}

export interface PostSuperbillResult {
  billId: string | null;
  /** Number of ABN acknowledgements recorded as directives. */
  abnRecorded: number;
}

/**
 * Post the reviewed superbill: create the bill for all priced lines (via the
 * existing billing path) and record an ABN directive for each non-covered line.
 * Returns the created bill id (or null if no line was priceable).
 */
export async function postSuperbill(
  ctx: ChargeContext,
  selections: SuperbillSelection[],
): Promise<PostSuperbillResult> {
  const lines: ChargeLineRequest[] = selections.map((s) => ({
    category: s.category,
    serviceCode: s.serviceCode,
    description: s.description,
    quantity: s.quantity ?? 1,
    unitPrice: s.unitPrice,
  }));
  const bill = await chargeForServices(ctx, lines);

  // Record ABN acknowledgements as chart directives so the consent trail lives
  // on the patient chart alongside other directives (P2.1). Best-effort per line:
  // a single failure must not abort the rest or skip the audit log below — the
  // bill is already posted, so we always record what happened.
  let abnRecorded = 0;
  let abnFailed = 0;
  for (const sel of selections.filter((s) => s.nonCovered)) {
    try {
      await addDirective(ctx.patientId, {
        type: 'abn_noncovered',
        description: `ABN: ${sel.description || sel.serviceCode || sel.category} — patient advised this service is not covered and accepts responsibility.`,
        recordedBy: ctx.generatedBy,
        recordedByName: ctx.generatedByName,
      });
      abnRecorded += 1;
    } catch {
      abnFailed += 1;
    }
  }

  await logAuditSafe('POST_SUPERBILL', ctx.generatedBy, ctx.generatedByName, `Superbill posted for patient ${ctx.patientId} (bill ${bill?._id ?? 'none'}, ${abnRecorded} ABN recorded${abnFailed ? `, ${abnFailed} ABN FAILED` : ''})`);
  return { billId: bill?._id ?? null, abnRecorded };
}
