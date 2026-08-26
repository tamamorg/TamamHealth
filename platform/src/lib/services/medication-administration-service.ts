import { medicationAdministrationsDB, pharmacyInventoryDB, prescriptionsDB, wardDB } from '../db';
import type {
  MedicationAdministration,
  MedicationAdministrationDoc,
  PharmacyInventoryDoc,
  PrescriptionDoc,
  UserRole,
} from '../db-types';
import type { AdmissionDoc } from '../db-types-ward';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { getUserById } from '@/modules/identity/services/user-service';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import { isPrnFrequency, isScheduledDoseAllowed } from '../clinical-flow/medication-schedule';

export interface AdministrationInput {
  prescriptionId: string;
  scheduledFor: string;
  /** Actual occurrence; defaults to the capture instant. */
  occurredAt?: string;
  status: MedicationAdministration['status'];
  doseGiven?: string;
  route?: string;
  administeredBy: string;
  administeredByName: string;
  administeredByRole?: UserRole;
  witnessId?: string;
  reason?: string;
  notes?: string;
}

export class MedicationAdministrationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'ORDER_NOT_FOUND'
      | 'ORDER_NOT_ACTIVE'
      | 'ADMISSION_NOT_ACTIVE'
      | 'DUPLICATE_DOSE'
      | 'REASON_REQUIRED'
      | 'WITNESS_REQUIRED'
      | 'WITNESS_INVALID'
      | 'INVALID_TIME'
      | 'WRITE_CONFLICT',
  ) {
    super(message);
    this.name = 'MedicationAdministrationError';
  }
}

function isConflict(error: unknown): boolean {
  const candidate = error as { name?: string; status?: number } | undefined;
  return candidate?.name === 'conflict' || candidate?.status === 409;
}

function normalizeMedication(value: string): string {
  return value.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function medicationMatches(order: string, stock: string): boolean {
  const ordered = normalizeMedication(order);
  const stocked = normalizeMedication(stock);
  return ordered === stocked || ordered.includes(stocked) || stocked.includes(ordered);
}

async function controlledMedication(rx: PrescriptionDoc): Promise<boolean> {
  if (!rx.hospitalId) return false;
  const inventory = await findByType<PharmacyInventoryDoc>(pharmacyInventoryDB(), 'pharmacy_inventory');
  return inventory.some(batch =>
    batch.hospitalId === rx.hospitalId
    && medicationMatches(rx.medication, batch.medicationName)
    && Boolean(batch.controlledSchedule || batch.requiresWitness)
  );
}

async function verifiedWitness(
  rx: PrescriptionDoc,
  actorId: string,
  witnessId?: string,
): Promise<{ id: string; name: string } | undefined> {
  if (!(await controlledMedication(rx))) return undefined;
  if (!witnessId) {
    throw new MedicationAdministrationError(
      `${rx.medication} is controlled medication. Select a second staff member to witness this dose.`,
      'WITNESS_REQUIRED',
    );
  }
  if (witnessId === actorId) {
    throw new MedicationAdministrationError('The administrator and witness must be different staff members.', 'WITNESS_INVALID');
  }
  const witness = await getUserById(witnessId);
  if (!witness || witness.isActive === false) {
    throw new MedicationAdministrationError('The witness could not be verified. Select an active staff member.', 'WITNESS_INVALID');
  }
  if (rx.orgId && witness.orgId && witness.orgId !== rx.orgId) {
    throw new MedicationAdministrationError('The witness must belong to the same organization.', 'WITNESS_INVALID');
  }
  const facilities = new Set([witness.hospitalId, ...(witness.facilityIds || [])].filter(Boolean));
  if (rx.hospitalId && !facilities.has(rx.hospitalId)) {
    throw new MedicationAdministrationError('The witness must work at this facility.', 'WITNESS_INVALID');
  }
  return { id: witness._id, name: witness.name };
}

export async function getAdministrationEvents(scope?: DataScope): Promise<MedicationAdministrationDoc[]> {
  const events = await findByType<MedicationAdministrationDoc>(medicationAdministrationsDB(), 'medication_administration');
  const visible = scope ? filterByScope(events, scope) : events;
  return visible.sort((a, b) => (a.recordedAt || '').localeCompare(b.recordedAt || ''));
}

export async function getAdministrationEventsForPrescription(
  prescriptionId: string,
  scope?: DataScope,
): Promise<MedicationAdministrationDoc[]> {
  return getAdministrationEventsForPrescriptions([prescriptionId], scope);
}

/** Fetch dose events for a bounded set of orders without scanning every MAR row. */
export async function getAdministrationEventsForPrescriptions(
  prescriptionIds: string[],
  scope?: DataScope,
): Promise<MedicationAdministrationDoc[]> {
  if (prescriptionIds.length === 0) return [];
  const events = await findByType<MedicationAdministrationDoc>(
    medicationAdministrationsDB(),
    'medication_administration',
    { prescriptionId: { $in: prescriptionIds } },
    { indexFields: ['type', 'prescriptionId'] },
  );
  const visible = scope ? filterByScope(events, scope) : events;
  return visible.sort((a, b) => (a.recordedAt || '').localeCompare(b.recordedAt || ''));
}

/** Compatibility projection for existing MAR components while storage migrates. */
export function projectAdministrationEvents(events: MedicationAdministrationDoc[]): MedicationAdministration[] {
  const voided = new Map<string, MedicationAdministrationDoc>();
  for (const event of events) {
    if (event.eventKind === 'void' && event.voidsAdministrationId) voided.set(event.voidsAdministrationId, event);
  }
  return events
    .filter(event => event.eventKind === 'administration')
    .map(event => {
      const correction = voided.get(event._id);
      return {
        id: event._id,
        scheduledFor: event.scheduledFor,
        recordedAt: event.recordedAt,
        status: event.status === 'entered_in_error' ? 'corrected' : event.status,
        doseGiven: event.doseGiven,
        route: event.route,
        administeredBy: event.administeredBy,
        administeredByName: event.administeredByName,
        witnessId: event.witnessId,
        witnessName: event.witnessName,
        reason: event.reason,
        notes: event.notes,
        voided: Boolean(correction),
        voidedAt: correction?.recordedAt,
        voidedBy: correction?.administeredBy,
        voidedReason: correction?.reason,
      } satisfies MedicationAdministration;
    });
}

export function mergeAdministrationEvents(
  legacy: MedicationAdministration[] | undefined,
  events: MedicationAdministrationDoc[],
): MedicationAdministration[] {
  const corrections = new Map(
    events
      .filter(event => event.eventKind === 'void' && event.voidsAdministrationId)
      .map(event => [event.voidsAdministrationId!, event]),
  );
  const oldRows = (legacy || []).map(row => {
    const correction = corrections.get(row.id);
    return correction
      ? {
          ...row,
          voided: true,
          voidedAt: correction.recordedAt,
          voidedBy: correction.administeredBy,
          voidedReason: correction.reason,
        }
      : row;
  });
  return [...oldRows, ...projectAdministrationEvents(events)];
}

export async function recordAdministration(input: AdministrationInput): Promise<MedicationAdministrationDoc> {
  const db = medicationAdministrationsDB();
  const rx = await prescriptionsDB().get(input.prescriptionId).catch(() => null) as PrescriptionDoc | null;
  if (!rx || rx.type !== 'prescription') {
    throw new MedicationAdministrationError('Medication order not found. Refresh the MAR.', 'ORDER_NOT_FOUND');
  }
  if (rx.status === 'discontinued') {
    throw new MedicationAdministrationError('This medication order was discontinued and cannot be administered.', 'ORDER_NOT_ACTIVE');
  }
  if (rx.admissionId) {
    const admission = await wardDB().get(rx.admissionId).catch(() => null) as AdmissionDoc | null;
    if (!admission || admission.status !== 'admitted' || admission.patientId !== rx.patientId) {
      throw new MedicationAdministrationError('This inpatient admission is no longer active. Refresh the MAR.', 'ADMISSION_NOT_ACTIVE');
    }
  }
  if (input.status !== 'given' && !input.reason?.trim()) {
    throw new MedicationAdministrationError(`Record why this dose was ${input.status}.`, 'REASON_REQUIRED');
  }
  const scheduled = new Date(input.scheduledFor);
  const occurred = new Date(input.occurredAt || new Date().toISOString());
  if (!Number.isFinite(scheduled.getTime()) || !Number.isFinite(occurred.getTime())) {
    throw new MedicationAdministrationError('Choose a valid medication time.', 'INVALID_TIME');
  }
  if (!isPrnFrequency(rx.frequency) && !isScheduledDoseAllowed(rx, input.scheduledFor)) {
    throw new MedicationAdministrationError('This time is outside the prescribed medication schedule or course.', 'INVALID_TIME');
  }
  const witness = await verifiedWitness(rx, input.administeredBy, input.witnessId);
  const existingEvents = await getAdministrationEventsForPrescription(rx._id);
  const projected = projectAdministrationEvents(existingEvents);
  if (!isPrnFrequency(rx.frequency) && projected.some(event => event.scheduledFor === input.scheduledFor && !event.voided)) {
    throw new MedicationAdministrationError(
      'This scheduled dose already has a record. Void the existing entry before recording a correction.',
      'DUPLICATE_DOSE',
    );
  }

  // Scheduled doses share an id across devices; PRN events are independent
  // occurrences and therefore carry a UUID.
  const scheduledAttempt = existingEvents.filter(event =>
    event.eventKind === 'administration' && event.scheduledFor === input.scheduledFor
  ).length;
  const id = isPrnFrequency(rx.frequency)
    ? `madm-prn-${uuidv4()}`
    : `madm:${rx._id}:${input.scheduledFor}${scheduledAttempt ? `:correction-${scheduledAttempt + 1}` : ''}`;
  const now = new Date().toISOString();
  const doc: MedicationAdministrationDoc = withPendingOfflineSync({
    _id: id,
    type: 'medication_administration',
    eventKind: 'administration',
    prescriptionId: rx._id,
    patientId: rx.patientId,
    patientName: rx.patientName,
    admissionId: rx.admissionId,
    hospitalId: rx.hospitalId,
    orgId: rx.orgId,
    scheduledFor: input.scheduledFor,
    occurredAt: occurred.toISOString(),
    recordedAt: now,
    status: input.status,
    doseGiven: input.doseGiven?.trim() || rx.dose,
    route: input.route?.trim() || rx.route,
    administeredBy: input.administeredBy,
    administeredByName: input.administeredByName,
    witnessId: witness?.id,
    witnessName: witness?.name,
    reason: input.reason?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }, now);
  try {
    const response = await db.put(doc);
    doc._rev = response.rev;
  } catch (error) {
    if (isConflict(error)) {
      throw new MedicationAdministrationError(
        'This scheduled dose was recorded on another workstation. Refresh the MAR before continuing.',
        'DUPLICATE_DOSE',
      );
    }
    throw error;
  }
  await logAuditSafe(
    'MEDICATION_ADMINISTERED', input.administeredBy, input.administeredByName,
    `${doc.status.toUpperCase()} ${rx.medication} ${doc.doseGiven} to ${rx.patientName} (Rx: ${rx._id})`
      + (doc.witnessName ? ` witnessed by ${doc.witnessName}` : ''),
  );
  emitSyncEvent({
    resourceType: doc.type, resourceId: doc._id, operation: 'create', resourceVersion: doc._rev,
    hospitalId: doc.hospitalId, orgId: doc.orgId,
  });
  return doc;
}

export async function voidAdministration(
  prescriptionId: string,
  administrationId: string,
  voidedBy: string,
  voidedByName: string,
  reason: string,
): Promise<MedicationAdministrationDoc> {
  if (!reason.trim()) throw new MedicationAdministrationError('A correction reason is required.', 'REASON_REQUIRED');
  const db = medicationAdministrationsDB();
  const [rx, storedTarget, events] = await Promise.all([
    prescriptionsDB().get(prescriptionId).catch(() => null) as Promise<PrescriptionDoc | null>,
    db.get(administrationId).catch(() => null) as Promise<MedicationAdministrationDoc | null>,
    getAdministrationEventsForPrescription(prescriptionId),
  ]);
  if (!rx) {
    throw new MedicationAdministrationError('Medication order not found. Refresh the MAR.', 'ORDER_NOT_FOUND');
  }
  const legacyTarget = (rx.administrations || []).find(row => row.id === administrationId);
  const target = storedTarget?.type === 'medication_administration' && storedTarget.eventKind === 'administration'
    ? storedTarget
    : legacyTarget
      ? {
          _id: legacyTarget.id,
          patientId: rx.patientId,
          patientName: rx.patientName,
          admissionId: rx.admissionId,
          hospitalId: rx.hospitalId,
          orgId: rx.orgId,
          scheduledFor: legacyTarget.scheduledFor,
        }
      : null;
  if (!target) {
    throw new MedicationAdministrationError('The administration entry no longer exists. Refresh the MAR.', 'ORDER_NOT_FOUND');
  }
  const prior = events.find(event => event.eventKind === 'void' && event.voidsAdministrationId === administrationId);
  if (prior) return prior;
  const now = new Date().toISOString();
  const correction: MedicationAdministrationDoc = withPendingOfflineSync({
    _id: `mvoid-${uuidv4()}`,
    type: 'medication_administration',
    eventKind: 'void',
    prescriptionId,
    patientId: target.patientId,
    patientName: target.patientName,
    admissionId: target.admissionId,
    hospitalId: target.hospitalId,
    orgId: target.orgId,
    scheduledFor: target.scheduledFor,
    occurredAt: now,
    recordedAt: now,
    status: 'entered_in_error',
    administeredBy: voidedBy,
    administeredByName: voidedByName,
    reason: reason.trim(),
    voidsAdministrationId: target._id,
    createdAt: now,
    updatedAt: now,
  }, now);
  const response = await db.put(correction);
  correction._rev = response.rev;
  await logAuditSafe('MEDICATION_ADMIN_VOIDED', voidedBy, voidedByName, `Voided ${rx.medication} administration ${target._id}: ${reason.trim()}`);
  emitSyncEvent({
    resourceType: correction.type, resourceId: correction._id, operation: 'create', resourceVersion: correction._rev,
    hospitalId: correction.hospitalId, orgId: correction.orgId,
  });
  return correction;
}
