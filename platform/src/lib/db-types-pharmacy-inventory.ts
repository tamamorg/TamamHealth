/**
 * Pharmacy inventory. One row per SKU per facility. The stock level
 * decrements when a prescription is dispensed and increments when a
 * receipt is recorded.
 */
import type { BaseDoc } from './db-types';

export interface PharmacyInventoryDoc extends BaseDoc {
  type: 'pharmacy_inventory';
  hospitalId: string;
  hospitalName: string;
  medicationName: string;
  category: string;
  stockLevel: number;
  unit: string;                      // tablets, vials, bottles, sachets, tubes
  reorderLevel: number;              // when to reorder
  batchNumber: string;
  expiryDate: string;                // YYYY-MM-DD
  lastReceived?: string;             // ISO datetime of last stock-in
  lastDispensed?: string;            // ISO datetime of last decrement
  dispensedToday: number;
  /**
   * Drug control schedule. Schedule II/III/IV require two-staff
   * witness sign-off on every movement (intake, dispense, waste).
   * Sourced from the South Sudan Drug & Food Control Authority list.
   */
  controlledSchedule?: 'I' | 'II' | 'III' | 'IV' | 'V';
  /** When true, dispense flow forces a witness staff selection. */
  requiresWitness?: boolean;
  orgId?: string;
}

/**
 * Audit log entry for every controlled-substance movement.
 * Two staff signatures (operator + witness) are mandatory by SSDFCA rules.
 */
export interface ControlledSubstanceLogDoc extends BaseDoc {
  type: 'controlled_substance_log';
  inventoryId: string;
  medicationName: string;
  schedule: 'I' | 'II' | 'III' | 'IV' | 'V';
  movement: 'intake' | 'dispense' | 'waste' | 'reconciliation' | 'transfer';
  quantity: number;
  unit: string;
  beforeBalance: number;
  afterBalance: number;
  patientId?: string;        // for dispense
  patientName?: string;
  prescriptionId?: string;
  // Two-signature audit
  operatorId: string;
  operatorName: string;
  witnessId: string;
  witnessName: string;
  reason?: string;
  facilityId: string;
  facilityName: string;
  orgId?: string;
}
