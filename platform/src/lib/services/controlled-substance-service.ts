/**
 * Controlled-substance audit service. Every movement of a Schedule I-V
 * medication (intake, dispense, waste, reconciliation, transfer)
 * generates an immutable log entry signed by both an operator and a
 * witness. Required by South Sudan Drug & Food Control Authority
 * (SSDFCA) inspections.
 *
 * The service refuses to record a movement if operator and witness
 * are the same person, if the math doesn't reconcile, or if either
 * signature is missing.
 */
import { controlledSubstanceLogDB } from '../db';
import type { ControlledSubstanceLogDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

export interface RecordMovementInput {
  inventoryId: string;
  medicationName: string;
  schedule: ControlledSubstanceLogDoc['schedule'];
  movement: ControlledSubstanceLogDoc['movement'];
  quantity: number;
  unit: string;
  beforeBalance: number;
  patientId?: string;
  patientName?: string;
  prescriptionId?: string;
  operatorId: string;
  operatorName: string;
  witnessId: string;
  witnessName: string;
  reason?: string;
  facilityId: string;
  facilityName: string;
  orgId?: string;
}

export class ControlledSubstanceError extends Error {
  constructor(message: string, public readonly code: 'SAME_SIGNATORY' | 'MISSING_WITNESS' | 'NEGATIVE_BALANCE' | 'BAD_INPUT') {
    super(message);
    this.name = 'ControlledSubstanceError';
  }
}

export async function recordMovement(input: RecordMovementInput): Promise<ControlledSubstanceLogDoc> {
  if (!input.operatorId || !input.witnessId) {
    throw new ControlledSubstanceError(
      'Both operator and witness signatures are required for controlled-substance movements.',
      'MISSING_WITNESS',
    );
  }
  if (input.operatorId === input.witnessId) {
    throw new ControlledSubstanceError(
      'Operator and witness must be two different staff members.',
      'SAME_SIGNATORY',
    );
  }
  if (input.quantity <= 0) {
    throw new ControlledSubstanceError('Movement quantity must be greater than zero.', 'BAD_INPUT');
  }

  const direction = input.movement === 'intake' ? 1 : -1;
  const afterBalance = input.beforeBalance + direction * input.quantity;
  if (afterBalance < 0) {
    throw new ControlledSubstanceError(
      `After-balance would be negative (${afterBalance}). Investigate before recording.`,
      'NEGATIVE_BALANCE',
    );
  }

  const db = controlledSubstanceLogDB();
  const now = new Date().toISOString();
  const doc: ControlledSubstanceLogDoc = {
    _id: `cslog-${uuidv4()}`,
    type: 'controlled_substance_log',
    ...input,
    afterBalance,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;

  await logAuditSafe('CONTROLLED_SUBSTANCE_MOVEMENT', input.operatorId, input.operatorName,
    `${input.movement.toUpperCase()} ${input.quantity} ${input.unit} of ${input.medicationName} (Schedule ${input.schedule}) — witness: ${input.witnessName}`,
  );

  emitSyncEvent({
    resourceType: 'controlled_substance_log',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function getMovementsForInventory(inventoryId: string): Promise<ControlledSubstanceLogDoc[]> {
  const db = controlledSubstanceLogDB();
  const rows = await findByType<ControlledSubstanceLogDoc>(
    db,
    'controlled_substance_log',
    { inventoryId },
    { indexFields: ['type', 'inventoryId'] },
  );
  return rows
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getAllMovements(scope?: DataScope): Promise<ControlledSubstanceLogDoc[]> {
  const db = controlledSubstanceLogDB();
  const all = (await findByType<ControlledSubstanceLogDoc>(db, 'controlled_substance_log'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

/** Daily reconciliation summary for shift close-out. */
export interface ReconciliationSummary {
  date: string;
  movementsByMedication: Record<string, {
    medicationName: string;
    schedule: ControlledSubstanceLogDoc['schedule'];
    netChange: number;
    intakes: number;
    dispenses: number;
    wastes: number;
    transfers: number;
  }>;
}

export async function dailyReconciliation(date: string, scope?: DataScope): Promise<ReconciliationSummary> {
  const all = await getAllMovements(scope);
  const sameDay = all.filter(m => (m.createdAt || '').slice(0, 10) === date);
  const byMed: ReconciliationSummary['movementsByMedication'] = {};
  for (const m of sameDay) {
    const key = m.inventoryId;
    if (!byMed[key]) {
      byMed[key] = {
        medicationName: m.medicationName,
        schedule: m.schedule,
        netChange: 0, intakes: 0, dispenses: 0, wastes: 0, transfers: 0,
      };
    }
    const slot = byMed[key];
    if (m.movement === 'intake') { slot.intakes += m.quantity; slot.netChange += m.quantity; }
    if (m.movement === 'dispense') { slot.dispenses += m.quantity; slot.netChange -= m.quantity; }
    if (m.movement === 'waste') { slot.wastes += m.quantity; slot.netChange -= m.quantity; }
    if (m.movement === 'transfer') { slot.transfers += m.quantity; slot.netChange -= m.quantity; }
  }
  return { date, movementsByMedication: byMed };
}
