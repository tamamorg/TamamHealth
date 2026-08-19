/**
 * Ledger Service — immutable, append-only financial record.
 * Every charge, payment, adjustment, refund, and write-off creates a ledger entry.
 * Patient balances are computed from the ledger, never stored separately.
 */
import { getDB } from '../db';
import type { LedgerEntryDoc, LedgerEntryType, PaymentMethodType } from '../db-types-payments';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { emitSyncEvent } from './sync-event-service';
import { getSettings } from '../settings/settings-store';

const ledgerDB = () => getDB('tamamhealth_ledger');

/**
 * Default currency for ledger entries when the caller doesn't specify one.
 * Defaults to South Sudanese Pound (SSP) for the South Sudan demo deployment;
 * override via `NEXT_PUBLIC_DEFAULT_CURRENCY` for other countries.
 */
const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || 'SSP';

/**
 * Effective default currency: prefer the live facility setting, then the
 * env-configured default, then 'SSP'. Used when a ledger entry doesn't carry
 * its own currency.
 */
function currencyDefault(): string {
  return getSettings().currency || DEFAULT_CURRENCY;
}

// ═══ Create Ledger Entry ═══════════════════════════════════════════

interface CreateLedgerEntryInput {
  patientId: string;
  encounterId?: string;
  entryType: LedgerEntryType;
  amount: number; // positive = debit (owes more), negative = credit (balance decreases)
  description: string;
  referenceId?: string;
  referenceType?: string;
  method?: PaymentMethodType;
  currency?: string;
  facilityId: string;
  orgId?: string;
  createdBy?: string;
  /** Stable caller-owned key for retry-safe financial mutations. */
  idempotencyKey?: string;
}

export async function createLedgerEntry(input: CreateLedgerEntryInput): Promise<LedgerEntryDoc> {
  const db = ledgerDB();
  const now = new Date().toISOString();

  // Calculate running balance
  const currentBalance = await getPatientBalance(input.patientId);
  const runningBalance = Math.round((currentBalance + input.amount) * 100) / 100;

  const doc: LedgerEntryDoc = {
    _id: input.idempotencyKey
      ? `ledger-idem-${input.idempotencyKey.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 120)}`
      : `ledger-${uuidv4().slice(0, 12)}`,
    type: 'ledger_entry',
    patientId: input.patientId,
    encounterId: input.encounterId,
    entryType: input.entryType,
    amount: input.amount,
    runningBalance,
    description: input.description,
    referenceId: input.referenceId,
    referenceType: input.referenceType,
    method: input.method,
    currency: input.currency || currencyDefault(),
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  let resp;
  try {
    resp = await db.put(doc);
  } catch (error) {
    if (input.idempotencyKey && (error as { status?: number }).status === 409) {
      return await db.get(doc._id) as LedgerEntryDoc;
    }
    throw error;
  }
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'ledger_entry',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

// ═══ Balance Queries ═══════════════════════════════════════════════

export async function getPatientBalance(patientId: string): Promise<number> {
  const entries = await getPatientLedger(patientId);
  if (entries.length === 0) return 0;
  // Sum all entry amounts (debits positive, credits negative). This is robust
  // to entries that share a createdAt timestamp — e.g. a bill that posts a
  // charge and an insurance credit in the same millisecond — whereas reading
  // the most-recent entry's stored runningBalance depends on a stable sort of
  // tied timestamps and could return the wrong figure.
  return Math.round(entries.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
}

export async function getEncounterBalance(encounterId: string): Promise<number> {
  const entries = await getEncounterLedger(encounterId);
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

export async function getPatientLedger(patientId: string, limit?: number): Promise<LedgerEntryDoc[]> {
  const db = ledgerDB();
  const entries = await findByType<LedgerEntryDoc>(db, 'ledger_entry', { patientId }, { indexFields: ['type', 'patientId'] });
  entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return limit ? entries.slice(0, limit) : entries;
}

export async function getEncounterLedger(encounterId: string): Promise<LedgerEntryDoc[]> {
  const db = ledgerDB();
  const entries = await findByType<LedgerEntryDoc>(db, 'ledger_entry', { encounterId }, { indexFields: ['type', 'encounterId'] });
  entries.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return entries;
}

// ═══ Aggregation Queries ═══════════════════════════════════════════

export async function getAllLedgerEntries(scope?: DataScope): Promise<LedgerEntryDoc[]> {
  const db = ledgerDB();
  const all = await findByType<LedgerEntryDoc>(db, 'ledger_entry');
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getLedgerSummary(scope?: DataScope): Promise<{
  totalCharged: number;
  totalCollected: number;
  totalInsurancePaid: number;
  totalAdjustments: number;
  totalRefunds: number;
  totalOutstanding: number;
  currency: string;
}> {
  const entries = await getAllLedgerEntries(scope);
  const currency = entries[0]?.currency || currencyDefault();

  const totalCharged = entries
    .filter(e => e.entryType === 'charge')
    .reduce((s, e) => s + e.amount, 0);
  const totalCollected = entries
    .filter(e => e.entryType === 'payment')
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const totalInsurancePaid = entries
    .filter(e => e.entryType === 'insurance_payment')
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const totalAdjustments = entries
    .filter(e => e.entryType === 'adjustment' || e.entryType === 'write_off')
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const totalRefunds = entries
    .filter(e => e.entryType === 'refund')
    .reduce((s, e) => s + e.amount, 0);

  // Outstanding = all debits - all credits
  const totalOutstanding = entries.reduce((s, e) => s + e.amount, 0);

  return { totalCharged, totalCollected, totalInsurancePaid, totalAdjustments, totalRefunds, totalOutstanding: Math.max(0, totalOutstanding), currency };
}

// ═══ Daily Reconciliation ══════════════════════════════════════════

export async function reconcileDay(date: string, scope?: DataScope): Promise<{
  ledgerTotal: number;
  paymentTotal: number;
  discrepancy: number;
  entries: number;
}> {
  const entries = await getAllLedgerEntries(scope);
  const dayEntries = entries.filter(e => (e.createdAt || '').startsWith(date));

  const ledgerTotal = dayEntries.reduce((s, e) => s + e.amount, 0);
  const paymentTotal = dayEntries
    .filter(e => e.entryType === 'payment' || e.entryType === 'insurance_payment')
    .reduce((s, e) => s + Math.abs(e.amount), 0);

  return {
    ledgerTotal,
    paymentTotal,
    discrepancy: Math.round((ledgerTotal + paymentTotal) * 100) / 100,
    entries: dayEntries.length,
  };
}
