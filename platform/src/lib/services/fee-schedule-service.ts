/**
 * Fee Schedule (Service Price Catalog) service.
 *
 * Org admins maintain a catalog of priced services (consultation, lab, pharmacy,
 * procedures, etc.). Clinical and front-desk workflows look up prices here to
 * generate charges, so "Amount Due" reflects real pricing instead of 0.
 *
 * The FeeScheduleDoc type, its PouchDB store, and sync config already exist;
 * this module adds the CRUD + lookup + charge-generation layer on top.
 */
import { getDB } from '../db';
import { getSettings } from '../settings/settings-store';
import type { FeeScheduleDoc, ChargeCategory, BillLineItem, BillingDoc } from '../db-types-billing';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { createBill, type CreateBillInput } from './billing-service';

const feeDB = () => getDB('tamamhealth_fee_schedule');

export interface FeeInput {
  facilityId: string;
  facilityName: string;
  category: ChargeCategory;
  serviceCode: string;
  serviceName: string;
  unitPrice: number;
  currency?: string;
  orgId?: string;
}

interface Actor { id?: string; name?: string }

// ===== CRUD =====

export async function getFeeSchedule(scope?: DataScope): Promise<FeeScheduleDoc[]> {
  const all = await findByType<FeeScheduleDoc>(feeDB(), 'fee_schedule');
  all.sort((a, b) => (a.category + a.serviceName).localeCompare(b.category + b.serviceName));
  return scope ? filterByScope(all, scope) : all;
}

export async function getActiveFees(scope?: DataScope): Promise<FeeScheduleDoc[]> {
  return (await getFeeSchedule(scope)).filter(f => f.isActive);
}

export async function createFee(input: FeeInput, by: Actor = {}): Promise<FeeScheduleDoc> {
  const now = new Date().toISOString();
  const doc: FeeScheduleDoc = {
    _id: `fee_${uuidv4()}`,
    type: 'fee_schedule',
    facilityId: input.facilityId,
    facilityName: input.facilityName,
    category: input.category,
    serviceCode: input.serviceCode,
    serviceName: input.serviceName,
    unitPrice: input.unitPrice,
    currency: input.currency || 'SSP',
    isActive: true,
    effectiveFrom: now,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await feeDB().put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('FEE_CREATED', by.id, by.name, `Fee ${input.serviceName} = ${input.unitPrice} ${doc.currency}`);
  emitSyncEvent({
    resourceType: 'fee_schedule',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updateFee(id: string, updates: Partial<FeeInput> & { isActive?: boolean }, by: Actor = {}): Promise<FeeScheduleDoc> {
  const db = feeDB();
  const doc = await db.get(id) as FeeScheduleDoc;
  const next: FeeScheduleDoc = { ...doc, ...updates, updatedAt: new Date().toISOString() };
  const resp = await db.put(next);
  next._rev = resp.rev;
  await logAuditSafe('FEE_UPDATED', by.id, by.name, `Fee ${next.serviceName} = ${next.unitPrice} ${next.currency}`);
  emitSyncEvent({
    resourceType: 'fee_schedule',
    resourceId: next._id,
    operation: 'update',
    resourceVersion: next._rev,
    orgId: next.orgId,
    hospitalId: next.facilityId,
  });
  return next;
}

export async function deleteFee(id: string, by: Actor = {}): Promise<void> {
  const db = feeDB();
  const doc = await db.get(id) as FeeScheduleDoc;
  if (doc._rev) await db.remove(doc._id, doc._rev);
  await logAuditSafe('FEE_DELETED', by.id, by.name, `Fee ${doc.serviceName} removed`);
  emitSyncEvent({
    resourceType: 'fee_schedule',
    resourceId: id,
    operation: 'delete',
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
}

// ===== Price lookup =====

/**
 * Resolve a price. Prefers an exact serviceCode match, otherwise the first
 * active fee in the category. Returns null when nothing is catalogued.
 */
export async function priceFor(
  category: ChargeCategory,
  scope?: DataScope,
  serviceCode?: string,
): Promise<FeeScheduleDoc | null> {
  const fees = await getActiveFees(scope);
  return priceFromFees(fees, category, serviceCode);
}

/** Resolve a price from an already-loaded catalog (no I/O). */
export function priceFromFees(
  fees: readonly FeeScheduleDoc[],
  category: ChargeCategory,
  serviceCode?: string,
): FeeScheduleDoc | null {
  if (serviceCode) {
    const exact = fees.find(f => f.serviceCode === serviceCode);
    if (exact) return exact;
  }
  return fees.find(f => f.category === category) || null;
}

// ===== Charge generation =====

export interface ChargeLineRequest {
  category: ChargeCategory;
  serviceCode?: string;
  /** Falls back to the catalogued name when omitted. */
  description?: string;
  quantity?: number;
  /** Explicit price override; otherwise looked up from the catalog. */
  unitPrice?: number;
  referenceId?: string;
  referenceType?: string;
}

export interface ChargeContext {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  facilityId: string;
  facilityName: string;
  facilityLevel: string;
  state: string;
  county?: string;
  orgId?: string;
  encounterId?: string;
  appointmentId?: string;
  generatedBy: string;
  generatedByName: string;
  currency?: string;
  scope?: DataScope;
}

/**
 * Build priced line items from the catalog and create a bill. Lines without a
 * resolvable price (no override and nothing catalogued) are skipped. Returns
 * null when no line ends up with a price, so callers never create empty bills.
 */
export async function chargeForServices(ctx: ChargeContext, lines: ChargeLineRequest[]): Promise<BillingDoc | null> {
  const items: BillLineItem[] = [];
  // Load the catalog at most once. The old loop called priceFor() for every
  // unpriced line, and priceFor() scans/filters the fee database each time — a
  // 12-line superbill produced 12 identical reads and index checks.
  const needsCatalog = lines.some(line => line.unitPrice == null);
  const fees = needsCatalog ? await getActiveFees(ctx.scope) : [];
  for (const line of lines) {
    let unitPrice = line.unitPrice;
    let description = line.description;
    if (unitPrice == null) {
      const fee = priceFromFees(fees, line.category, line.serviceCode);
      if (!fee) continue; // nothing catalogued — skip rather than charge 0
      unitPrice = fee.unitPrice;
      description = description || fee.serviceName;
    }
    const quantity = line.quantity ?? 1;
    items.push({
      id: uuidv4(),
      category: line.category,
      description: description || line.category,
      quantity,
      unitPrice,
      totalPrice: Math.round(quantity * unitPrice * 100) / 100,
      referenceId: line.referenceId,
      referenceType: line.referenceType,
    });
  }
  if (items.length === 0) return null;

  const input: CreateBillInput = {
    patientId: ctx.patientId,
    patientName: ctx.patientName,
    hospitalNumber: ctx.hospitalNumber,
    facilityId: ctx.facilityId,
    facilityName: ctx.facilityName,
    facilityLevel: ctx.facilityLevel,
    encounterDate: new Date().toISOString(),
    encounterId: ctx.encounterId,
    appointmentId: ctx.appointmentId,
    items,
    currency: ctx.currency || 'SSP',
    // Default service tax/VAT from facility settings (0 for public facilities).
    taxRate: getSettings().taxRatePercent || undefined,
    generatedBy: ctx.generatedBy,
    generatedByName: ctx.generatedByName,
    state: ctx.state,
    county: ctx.county,
    orgId: ctx.orgId,
  };

  // If the patient carries an active insurance policy, stamp the payer and the
  // share insurance covers, so the patient is billed their responsibility
  // (coinsurance + copay) rather than the gross amount. Best-effort: charging
  // never fails because of an insurance lookup.
  try {
    const { getPrimaryPolicy } = await import('./payment-service');
    const policy = await getPrimaryPolicy(ctx.patientId);
    if (policy?.payerName && policy.isActive) {
      input.insuranceProvider = policy.payerName;
      const subtotal = items.reduce((sum, it) => sum + it.totalPrice, 0);
      const coverageFraction = Math.max(0, Math.min(1, (100 - (policy.coinsurancePct ?? 0)) / 100));
      const copay = policy.copayAmount ?? 0;
      const insurancePays = Math.max(0, subtotal * coverageFraction - copay);
      input.insuranceCoveragePercent = subtotal > 0
        ? Math.round((insurancePays / subtotal) * 10000) / 100
        : 0;
    }
  } catch {
    /* no policy / lookup failed — bill as cash */
  }

  return createBill(input);
}
