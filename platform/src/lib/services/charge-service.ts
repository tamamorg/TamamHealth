/**
 * Charge Service — billable line items raised against an encounter. Split
 * out of payment-service.ts; re-exported from there so no caller needs to
 * change.
 */
import type { ChargeDoc, ChargeStatus } from '../db-types-payments';
import { v4 as uuidv4 } from 'uuid';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { createLedgerEntry } from './ledger-service';
import { assertRefExists, chargesDB } from './payment-dbs';

// ═══════════════════════════════════════════════════════════════════
// CHARGES
// ═══════════════════════════════════════════════════════════════════

export interface CreateChargeInput {
  encounterId: string;
  patientId: string;
  cptCode?: string;
  icdCodes?: string[];
  modifier?: string;
  description: string;
  category: string;
  units: number;
  billedAmount: number;
  serviceDate: string;
  providerId?: string;
  providerName?: string;
  facilityId: string;
  orgId?: string;
  createdBy?: string;
}

export async function createCharge(input: CreateChargeInput): Promise<ChargeDoc> {
  const db = chargesDB();
  const now = new Date().toISOString();
  // Don't create a charge linked to a non-existent encounter.
  await assertRefExists('tamamhealth_encounters', input.encounterId, 'Encounter');

  const doc: ChargeDoc = {
    _id: `chg-${uuidv4().slice(0, 10)}`,
    type: 'charge',
    ...input,
    status: 'pending' as ChargeStatus,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  // Create ledger entry (positive = debit = patient owes more)
  await createLedgerEntry({
    patientId: input.patientId,
    encounterId: input.encounterId,
    entryType: 'charge',
    amount: input.billedAmount * input.units,
    description: `Charge: ${input.description} (${input.units}x $${input.billedAmount})`,
    referenceId: doc._id,
    referenceType: 'charge',
    currency: 'SSP',
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdBy: input.createdBy,
  });

  emitSyncEvent({
    resourceType: 'charge',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function getChargesByEncounter(encounterId: string): Promise<ChargeDoc[]> {
  const db = chargesDB();
  return findByType<ChargeDoc>(db, 'charge', { encounterId }, { indexFields: ['type', 'encounterId'] });
}

export async function getChargesByPatient(patientId: string): Promise<ChargeDoc[]> {
  const rows = await findByType<ChargeDoc>(chargesDB(), 'charge', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''));
}
