/**
 * Invoice Service — patient invoice generation and status. Split out of
 * payment-service.ts; re-exported from there so no caller needs to change.
 */
import type { InvoiceDoc, InvoiceLineItem, InvoiceStatus } from '../db-types-payments';
import { v4 as uuidv4 } from 'uuid';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { nextSequence } from './doc-counter';
import { invoicesDB } from './payment-dbs';

// ═══════════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════════

/**
 * Highest invoice number already issued, so a fresh counter starts above any
 * number an existing dataset already used.
 */
async function highestInvoiceNumber(db: Parameters<typeof nextSequence>[0]): Promise<number> {
  const invoices = await findByType<InvoiceDoc>(db as never, 'invoice');
  let highest = 0;
  for (const inv of invoices) {
    const num = inv.invoiceNumber;
    if (typeof num !== 'string' || !num.startsWith('INV-')) continue;
    const parsed = Number.parseInt(num.slice(4), 10);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return highest;
}

export async function generateInvoice(input: {
  patientId: string;
  patientName: string;
  encounterId?: string;
  lineItems: InvoiceLineItem[];
  insurancePayments?: number;
  adjustments?: number;
  priorPayments?: number;
  currency?: string;
  dueInDays?: number;
  facilityId: string;
  facilityName: string;
  orgId?: string;
  createdBy?: string;
}): Promise<InvoiceDoc> {
  const db = invoicesDB();
  const now = new Date().toISOString();

  const subtotal = input.lineItems.reduce((s, li) => s + li.patientResponsibility, 0);
  const insurancePayments = input.insurancePayments || 0;
  const adjustments = input.adjustments || 0;
  const priorPayments = input.priorPayments || 0;
  const totalDue = Math.max(0, Math.round((subtotal - insurancePayments - adjustments - priorPayments) * 100) / 100);

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (input.dueInDays || 30));

  // Monotonic counter rather than `allDocs().total_rows`. The old count fell
  // when an invoice was deleted, so the next invoice reissued a number already
  // in use — two distinct invoices sharing one reference, and a payment that
  // could be reconciled against either. See doc-counter.ts.
  const seqNum = await nextSequence(db, 'invoice', () => highestInvoiceNumber(db));
  const seq = String(seqNum).padStart(5, '0');

  const doc: InvoiceDoc = {
    _id: `inv-${uuidv4().slice(0, 10)}`,
    type: 'invoice',
    invoiceNumber: `INV-${seq}`,
    patientId: input.patientId,
    patientName: input.patientName,
    encounterId: input.encounterId,
    lineItems: input.lineItems,
    subtotal,
    insurancePayments,
    adjustments,
    priorPayments,
    totalDue,
    currency: input.currency || 'SSP',
    issuedDate: now.slice(0, 10),
    dueDate: dueDate.toISOString().slice(0, 10),
    status: 'draft' as InvoiceStatus,
    paymentLinkToken: uuidv4().slice(0, 16),
    facilityId: input.facilityId,
    facilityName: input.facilityName,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'invoice',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function getInvoicesByPatient(patientId: string): Promise<InvoiceDoc[]> {
  const rows = await findByType<InvoiceDoc>(invoicesDB(), 'invoice', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.issuedDate || '').localeCompare(a.issuedDate || ''));
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<InvoiceDoc | null> {
  const db = invoicesDB();
  try {
    const doc = await db.get(id) as InvoiceDoc;
    doc.status = status;
    if (status === 'sent') doc.sentAt = new Date().toISOString();
    if (status === 'viewed') doc.viewedAt = new Date().toISOString();
    if (status === 'paid') doc.paidAt = new Date().toISOString();
    doc.updatedAt = new Date().toISOString();
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'invoice',
      resourceId: doc._id,
      operation: 'update',
      resourceVersion: doc._rev,
      orgId: doc.orgId,
      hospitalId: doc.facilityId,
    });
    return doc;
  } catch { return null; }
}
