/**
 * Internal patient transfer — moving care ownership between providers,
 * departments and facilities.
 *
 * The workflow is request → accept → complete, and the reason it is a workflow
 * rather than a field edit is stated at `PatientTransferDoc` in db-types.ts.
 * Three invariants hold everywhere in this file:
 *
 *  1. **Ownership only moves inside `applyAssignment`.** No other function
 *     writes `patient.assignedDoctor`. If a transfer never reaches `completed`,
 *     the patient's assignment is untouched — a rejected or cancelled request
 *     leaves no trace on the chart beyond its own history.
 *
 *  2. **`events` is append-only.** Status fields on the doc are a summary of
 *     the latest event and may be corrected; the event array is the record.
 *     Nothing here splices, filters or rewrites it.
 *
 *  3. **Every state change writes an audit row before it returns.** A transfer
 *     that moved responsibility without leaving an audit trail is worse than
 *     one that failed, so the audit write is part of the transition, not a
 *     side-effect a caller can forget.
 */
import { v4 as uuidv4 } from 'uuid';
import {
  patientTransfersDB, patientsDB, problemsDB, prescriptionsDB, clinicianTasksDB, getDB,
  medicalRecordsDB,
} from '../db';
import type {
  PatientTransferDoc,
  PatientTransferEvent,
  PatientTransferEventKind,
  PatientTransferAssignment,
  PatientTransferChecklistItem,
  PatientTransferStatus,
  PatientTransferSummary,
  PatientTransferType,
  PatientTransferUrgency,
  PatientDoc,
  ProblemDoc,
  PrescriptionDoc,
  ClinicianTaskDoc,
  MedicalRecordDoc,
  CareTeamMember,
  UserRole,
  PatientTransferPhysicalStatus,
  PatientTransferLocation,
  PatientTransferTransport,
  PatientTransferClinicalReadiness,
  PatientTransferCommunication,
} from '../db-types';
import type { DataScope } from './data-scope';
import type { BedDoc } from '../db-types-ward';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { withPendingOfflineSync } from '../sync/offline-metadata';

// ── Acknowledgement SLA ──────────────────────────────────────────────────
//
// Mirrors the referral SLA (referral-service.REFERRAL_SLA_HOURS) on purpose:
// an internal hand-off that nobody answers strands a patient exactly the way an
// unacknowledged referral does, and staff should not have to learn two
// different sets of expectations for the same failure.
export const TRANSFER_SLA_HOURS: Record<PatientTransferUrgency, number> = {
  emergency: 2,
  urgent: 12,
  routine: 48,
};

/** Statuses that mean the receiving side has answered. */
const DECIDED_STATUSES = new Set<PatientTransferStatus>([
  'accepted', 'rejected', 'cancelled', 'completed', 'expired',
]);

/** Statuses in which the transfer is still live and awaiting something. */
export const OPEN_TRANSFER_STATUSES = new Set<PatientTransferStatus>([
  'draft', 'requested', 'accepted',
]);

export function transferDeadline(urgency: PatientTransferUrgency, fromIso: string): string {
  const hours = TRANSFER_SLA_HOURS[urgency] ?? TRANSFER_SLA_HOURS.routine;
  return new Date(new Date(fromIso).getTime() + hours * 3600_000).toISOString();
}

/**
 * True when a request has gone unanswered past its deadline. A transfer with no
 * `requestedAt` is never reported as breached — absence of a clock is not
 * evidence of a missed one.
 */
export function isTransferOverdue(t: PatientTransferDoc, now: Date = new Date()): boolean {
  if (t.status !== 'requested' || !t.requestedAt) return false;
  return new Date(transferDeadline(t.urgency, t.requestedAt)).getTime() < now.getTime();
}

// ── Hand-off checklist ───────────────────────────────────────────────────

/**
 * The default pre-transfer checklist. `required` items block sending, so the
 * clinician has to have actually looked at the medication list and the open
 * tasks before handing the patient on — the two things most often dropped at a
 * hand-off. Attachments/care-plan review are prompted but not blocking.
 */
export const DEFAULT_TRANSFER_CHECKLIST: ReadonlyArray<Omit<PatientTransferChecklistItem, 'done'>> = [
  { key: 'care_plan_reviewed', label: 'Care plan reviewed', required: false },
  { key: 'medications_reviewed', label: 'Medications reviewed', required: true },
  { key: 'open_tasks_reviewed', label: 'Open tasks reviewed', required: true },
  { key: 'recent_notes_reviewed', label: 'Recent notes reviewed', required: false },
  { key: 'reason_documented', label: 'Reason for transfer documented', required: true },
];

export function defaultChecklist(): PatientTransferChecklistItem[] {
  return DEFAULT_TRANSFER_CHECKLIST.map(item => ({ ...item, done: false }));
}

/**
 * Rebuild a caller-supplied checklist against the canonical list.
 *
 * Only the `done` flags are taken from the caller; every key, label and
 * `required` flag comes from `DEFAULT_TRANSFER_CHECKLIST`. Without this the
 * gate is trivially defeated — a client can post a checklist with the required
 * items deleted (or relabelled as optional) and `outstandingChecklistItems`
 * finds nothing to complain about. The checklist is meant to be evidence that
 * the medication list and open tasks were reviewed, so the set of things that
 * must be reviewed cannot be up to the caller.
 */
export function normalizeChecklist(
  supplied: PatientTransferChecklistItem[] | undefined,
): PatientTransferChecklistItem[] {
  const byKey = new Map((supplied ?? []).map(i => [i.key, i]));
  return DEFAULT_TRANSFER_CHECKLIST.map(canonical => {
    const match = byKey.get(canonical.key);
    return {
      ...canonical,
      done: match?.done === true,
      completedAt: match?.done === true ? match.completedAt : undefined,
      completedById: match?.done === true ? match.completedById : undefined,
    };
  });
}

/** Required checklist keys that are still outstanding. */
export function outstandingChecklistItems(
  checklist: PatientTransferChecklistItem[] | undefined,
): PatientTransferChecklistItem[] {
  return (checklist ?? []).filter(i => i.required && !i.done);
}

// ── Actors + events ──────────────────────────────────────────────────────

export interface TransferActor {
  id?: string;
  name?: string;
  role?: UserRole;
}

function makeEvent(
  kind: PatientTransferEventKind,
  message: string,
  actor?: TransferActor,
  extra: Partial<PatientTransferEvent> = {},
): PatientTransferEvent {
  return {
    id: `xfer-ev-${uuidv4()}`,
    kind,
    message,
    actorId: actor?.id,
    actorName: actor?.name,
    actorRole: actor?.role,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

export function describeAssignment(a: PatientTransferAssignment | undefined): string {
  if (!a) return 'unassigned';
  const parts = [a.providerName, a.department, a.facilityName].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'unassigned';
}

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Hide other people's unsent drafts.
 *
 * A draft is a half-composed thought — it may name a destination the author is
 * still deciding about, or carry a reason they intend to reword. Showing it on
 * the chart alongside real transfers would read as "a transfer to Dr X is in
 * progress" when nothing has been requested at all.
 *
 * `viewerId` omitted means a non-user caller (the sweep, a server job). Those
 * see everything, which is correct: they act on status, and no status they act
 * on is `draft`.
 */
function hideOthersDrafts(
  rows: PatientTransferDoc[],
  viewerId?: string,
): PatientTransferDoc[] {
  if (!viewerId) return rows;
  return rows.filter(t => t.status !== 'draft' || t.requestedById === viewerId);
}

export async function getAllTransfers(
  scope?: DataScope,
  viewerId?: string,
): Promise<PatientTransferDoc[]> {
  const rows = await findByType<PatientTransferDoc>(patientTransfersDB(), 'patient_transfer');
  const visible = hideOthersDrafts(scope ? filterByScope(rows, scope) : rows, viewerId);
  return visible.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getTransferById(id: string): Promise<PatientTransferDoc | null> {
  try {
    return await patientTransfersDB().get(id) as PatientTransferDoc;
  } catch {
    return null;
  }
}

/** Full transfer history for one patient, newest first. This is the chart tab. */
export async function getTransfersByPatient(
  patientId: string,
  scope?: DataScope,
  viewerId?: string,
): Promise<PatientTransferDoc[]> {
  const rows = await findByType<PatientTransferDoc>(
    patientTransfersDB(),
    'patient_transfer',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  const visible = hideOthersDrafts(scope ? filterByScope(rows, scope) : rows, viewerId);
  return visible.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/**
 * Transfers awaiting THIS user's decision — their inbox.
 *
 * Matches both personally-addressed transfers and ones addressed to the user's
 * department/facility, because a transfer sent to "Paediatrics" with nobody
 * named still has to appear somewhere or it waits forever.
 */
export async function getIncomingTransfers(
  user: { id: string; department?: string; hospitalId?: string; role?: UserRole },
  scope?: DataScope,
): Promise<PatientTransferDoc[]> {
  const all = await getAllTransfers(scope);
  return all.filter(t => {
    if (t.status !== 'requested') return false;
    const to = t.to;
    if (to.providerId) return to.providerId === user.id;
    if (to.department && user.department) {
      return to.department.toLowerCase() === user.department.toLowerCase()
        && (!to.facilityId || !user.hospitalId || to.facilityId === user.hospitalId);
    }
    if (to.facilityId) return to.facilityId === user.hospitalId;
    return false;
  });
}

/** Transfers this user has sent and is waiting on. */
export async function getOutgoingTransfers(
  userId: string,
  scope?: DataScope,
): Promise<PatientTransferDoc[]> {
  const all = await getAllTransfers(scope);
  return all.filter(t =>
    OPEN_TRANSFER_STATUSES.has(t.status)
    && (t.requestedById === userId || t.from.providerId === userId));
}

/** Requests past their acknowledgement deadline, most overdue first. */
export async function getOverdueTransfers(
  scope?: DataScope,
  now: Date = new Date(),
): Promise<PatientTransferDoc[]> {
  const all = await getAllTransfers(scope);
  return all
    .filter(t => isTransferOverdue(t, now))
    .sort((a, b) => (a.requestedAt || '').localeCompare(b.requestedAt || ''));
}

/**
 * Who was accountable for this patient on a given date.
 *
 * This is the question a complaint or an incident review opens with, and it is
 * the reason ownership history is kept as documents rather than overwritten on
 * the patient.
 *
 * Each ownership-changing transfer contributes up to TWO boundaries on the
 * timeline, not one: a temporary transfer hands the patient over at
 * `effectiveAt` and hands them BACK at `expiresAt`. Collapsing it to a single
 * boundary would report the covering clinician as still accountable years after
 * their cover ended.
 *
 * The hand-back is conditional, mirroring `expireTransfer` exactly: if
 * ownership had already moved on to a third party before the grant lapsed,
 * nothing was returned, so the boundary is skipped rather than clobbering the
 * later, deliberate transfer.
 *
 * Shared-care grants contribute nothing — they never move ownership.
 */
export function ownerAt(
  transfers: PatientTransferDoc[],
  at: Date | string,
): PatientTransferAssignment | null {
  const when = new Date(at).getTime();

  const owning = transfers
    .filter(t => t.status === 'completed' || t.status === 'expired')
    .filter(t => t.transferType !== 'shared_care');
  if (owning.length === 0) return null;

  type Boundary = {
    at: number;
    kind: 'take' | 'return';
    to: PatientTransferAssignment;
    holder?: string;
  };
  const boundaries: Boundary[] = [];

  for (const t of owning) {
    const takeAt = new Date(t.effectiveAt || t.completedAt || t.updatedAt).getTime();
    if (Number.isFinite(takeAt)) {
      boundaries.push({ at: takeAt, kind: 'take', to: t.to });
    }
    // Only a lapsed time-boxed transfer returns the patient.
    if (t.status === 'expired' && t.transferType === 'temporary' && t.expiresAt) {
      const backAt = new Date(t.expiresAt).getTime();
      if (Number.isFinite(backAt)) {
        boundaries.push({ at: backAt, kind: 'return', to: t.from, holder: t.to.providerId });
      }
    }
  }
  boundaries.sort((a, b) => a.at - b.at);

  let owner: PatientTransferAssignment | null = null;
  for (const b of boundaries) {
    if (b.at > when) break;
    if (b.kind === 'return' && owner?.providerId !== b.holder) continue;
    owner = b.to;
  }
  // Before the first recorded move, the earliest transfer's `from` side is the
  // best evidence we have of who held the patient.
  const earliest = boundaries.find(b => b.kind === 'take');
  return owner ?? owning.find(t => new Date(t.effectiveAt || t.completedAt || t.updatedAt).getTime() === earliest?.at)?.from ?? null;
}

/** Care-team grants that have not lapsed. Expired entries are never access. */
export function activeCareTeam(
  patient: Pick<PatientDoc, 'careTeam'>,
  now: Date = new Date(),
): CareTeamMember[] {
  return (patient.careTeam ?? []).filter(
    m => !m.expiresAt || new Date(m.expiresAt).getTime() > now.getTime(),
  );
}

// ── Hand-off summary ─────────────────────────────────────────────────────

/**
 * Assemble the clinical snapshot the receiving clinician decides on.
 *
 * Names and counts only — no doses, no result values, no note bodies. The
 * receiver has chart access once they accept; before that they need enough to
 * judge whether they can take the patient, not the record itself. Every lookup
 * is individually guarded because a summary that fails to build must not block
 * a clinically urgent transfer: a partial snapshot is recoverable, a transfer
 * that cannot be raised is not.
 */
export async function buildTransferSummary(patientId: string): Promise<PatientTransferSummary> {
  const summary: PatientTransferSummary = {};

  try {
    const problems = await findByType<ProblemDoc>(
      problemsDB(), 'problem', { patientId }, { indexFields: ['type', 'patientId'] },
    );
    summary.activeProblems = problems
      .filter(p => p.status === 'active')
      .map(p => p.name)
      .slice(0, 20);
  } catch { /* snapshot stays partial rather than blocking the transfer */ }

  try {
    const scripts = await findByType<PrescriptionDoc>(
      prescriptionsDB(), 'prescription', { patientId }, { indexFields: ['type', 'patientId'] },
    );
    summary.activeMedications = scripts
      .filter(p => p.status !== 'discontinued' && !p.stoppedAt)
      .map(p => p.medication)
      .slice(0, 30);
  } catch { /* ignore */ }

  try {
    const tasks = await findByType<ClinicianTaskDoc>(
      clinicianTasksDB(), 'clinician_task', { patientId }, { indexFields: ['type', 'patientId'] },
    );
    summary.openTaskCount = tasks.filter(t => t.status === 'open').length;
  } catch { /* ignore */ }

  try {
    const records = await findByType<MedicalRecordDoc>(
      medicalRecordsDB(), 'medical_record', { patientId }, { indexFields: ['type', 'patientId'] },
    );
    const latest = records
      .slice()
      .sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''))[0];
    if (latest) {
      summary.lastEncounterDate = latest.visitDate;
      summary.lastEncounterSummary = latest.chiefComplaint;
    }
  } catch { /* ignore */ }

  try {
    const patient = await patientsDB().get(patientId) as PatientDoc;
    summary.allergies = (patient.allergies ?? []).slice(0, 20);
    // Risk flags come from chart-permanent care alerts, which is exactly the
    // information a receiving clinician must not have to go looking for.
    summary.riskFlags = (patient.careAlerts ?? [])
      .filter(a => a.status === 'active')
      .map(a => a.message || a.category)
      .filter((v): v is string => Boolean(v))
      .slice(0, 10);
  } catch { /* ignore */ }

  return summary;
}

// ── Writes ───────────────────────────────────────────────────────────────

async function persist(
  doc: PatientTransferDoc,
  auditAction: string,
  auditDetail: string,
  actor?: TransferActor,
): Promise<PatientTransferDoc> {
  const db = patientTransfersDB();
  const saved = withPendingOfflineSync({ ...doc, updatedAt: new Date().toISOString() });
  const resp = await db.put(saved);
  saved._rev = resp.rev;

  await logAuditSafe(auditAction, actor?.id, actor?.name, auditDetail);
  await emitSyncEvent({
    resourceType: 'patient_transfer',
    resourceId: saved._id,
    operation: 'update',
    resourceVersion: saved._rev,
    userId: actor?.id,
    username: actor?.name,
    orgId: saved.orgId,
    hospitalId: saved.hospitalId,
  });
  return saved;
}

export interface CreateTransferInput {
  patientId: string;
  patientName?: string;
  hospitalNumber?: string;
  transferType?: PatientTransferType;
  urgency?: PatientTransferUrgency;
  from: PatientTransferAssignment;
  to: PatientTransferAssignment;
  reason: string;
  handoffNotes?: string;
  checklist?: PatientTransferChecklistItem[];
  effectiveAt?: string;
  expiresAt?: string;
  autoCompleteOnEffectiveDate?: boolean;
  destination?: PatientTransferLocation;
  transport?: PatientTransferTransport;
  clinicalReadiness?: PatientTransferClinicalReadiness;
  communication?: PatientTransferCommunication;
  /** Save without sending. Drafts are visible only to their author. */
  asDraft?: boolean;
  hospitalId?: string;
  orgId?: string;
  actor?: TransferActor;
}

/** Thrown for input the caller can fix; the API maps these to 400. */
export class TransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferValidationError';
  }
}

const TRANSFER_TYPES = new Set<PatientTransferType>(['permanent', 'temporary', 'shared_care']);
const URGENCIES = new Set<PatientTransferUrgency>(['routine', 'urgent', 'emergency']);

function validateInput(input: CreateTransferInput): void {
  if (!input.patientId) throw new TransferValidationError('patientId is required');
  // Reject unknown enum values rather than letting them fall through to a
  // default. An unrecognised `transferType` would be treated as `permanent` by
  // `applyAssignment` — silently moving ownership outright when the caller
  // asked for something else.
  if (input.transferType && !TRANSFER_TYPES.has(input.transferType)) {
    throw new TransferValidationError(`Unknown transfer type: ${input.transferType}`);
  }
  if (input.urgency && !URGENCIES.has(input.urgency)) {
    throw new TransferValidationError(`Unknown urgency: ${input.urgency}`);
  }
  for (const [label, value] of [
    ['effectiveAt', input.effectiveAt], ['expiresAt', input.expiresAt],
  ] as const) {
    if (value && Number.isNaN(new Date(value).getTime())) {
      throw new TransferValidationError(`Invalid ${label} timestamp: ${value}`);
    }
  }
  if (!input.reason || !input.reason.trim()) {
    throw new TransferValidationError('A reason for the transfer is required');
  }
  const to = input.to || {};
  if (!to.providerId && !to.department && !to.facilityId) {
    throw new TransferValidationError(
      'A destination provider, department or facility is required',
    );
  }
  // A transfer that changes nothing is almost always a mis-click, and letting
  // it through puts a meaningless entry in the ownership history.
  if (input.from?.providerId && to.providerId === input.from.providerId
      && (to.department ?? input.from.department) === input.from.department
      && (to.facilityId ?? input.from.facilityId) === input.from.facilityId) {
    throw new TransferValidationError('The destination is the same as the current assignment');
  }
  const type = input.transferType ?? 'permanent';
  if (type !== 'permanent' && !input.expiresAt) {
    throw new TransferValidationError(
      `A ${type === 'temporary' ? 'temporary transfer' : 'shared-care grant'} needs an end date`,
    );
  }
  if (input.expiresAt && input.effectiveAt
      && new Date(input.expiresAt) <= new Date(input.effectiveAt)) {
    throw new TransferValidationError('The end date must be after the effective date');
  }
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new TransferValidationError('The end date is already in the past');
  }
}

/**
 * Raise a transfer. Defaults to `requested` — the safe baseline where the
 * receiving side must acknowledge before responsibility moves.
 */
export async function createTransferRequest(
  input: CreateTransferInput,
): Promise<PatientTransferDoc> {
  validateInput(input);

  const now = new Date().toISOString();
  const asDraft = input.asDraft === true;
  // Never trust the caller's checklist shape — see `normalizeChecklist`.
  const checklist = normalizeChecklist(input.checklist);

  if (!asDraft) {
    const outstanding = outstandingChecklistItems(checklist);
    if (outstanding.length > 0) {
      throw new TransferValidationError(
        `Complete the hand-off checklist before sending: ${outstanding.map(i => i.label).join(', ')}`,
      );
    }
  }

  // Snapshot the chart as it stands now. Built at request time, not read at
  // accept time, so the history shows what the receiver was actually shown.
  const summary = await buildTransferSummary(input.patientId);

  const doc: PatientTransferDoc = {
    _id: `patient-transfer-${uuidv4()}`,
    type: 'patient_transfer',
    patientId: input.patientId,
    patientName: input.patientName,
    hospitalNumber: input.hospitalNumber,
    transferType: input.transferType ?? 'permanent',
    status: asDraft ? 'draft' : 'requested',
    urgency: input.urgency ?? 'routine',
    from: input.from ?? {},
    to: input.to,
    reason: input.reason.trim(),
    handoffNotes: input.handoffNotes,
    summary,
    checklist,
    requestedById: input.actor?.id,
    requestedByName: input.actor?.name,
    requestedByRole: input.actor?.role,
    requestedAt: asDraft ? undefined : now,
    effectiveAt: input.effectiveAt,
    expiresAt: input.expiresAt,
    autoCompleteOnEffectiveDate: input.autoCompleteOnEffectiveDate ?? true,
    physicalStatus: 'not_scheduled',
    destination: input.destination,
    transport: input.transport ?? { status: 'not_requested' },
    clinicalReadiness: input.clinicalReadiness,
    communication: input.communication,
    events: [],
    hospitalId: input.hospitalId ?? input.from?.facilityId,
    // Flat mirrors of the destination, for `filterByScope` (which cannot read
    // nested fields). Falls back to the sending facility/org when the transfer
    // does not cross a boundary, so the key is always populated and a
    // same-facility transfer is not accidentally treated as unaddressed.
    toHospitalId: input.to?.facilityId ?? input.hospitalId ?? input.from?.facilityId,
    orgId: input.orgId ?? input.from?.orgId,
    // Set ONLY when the destination org genuinely differs. `filterByScope`
    // treats a `toOrgId` match as a cross-tenant visibility grant and documents
    // that it stays narrow because nothing populates it otherwise; writing it
    // unconditionally would hand every transfer a second, redundant way to
    // satisfy the tenant check.
    toOrgId: input.to?.orgId && input.to.orgId !== (input.orgId ?? input.from?.orgId)
      ? input.to.orgId
      : undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor?.id,
  };

  doc.events.push(makeEvent(
    asDraft ? 'TRANSFER_DRAFTED' : 'TRANSFER_REQUESTED',
    asDraft
      ? 'Transfer drafted'
      : `Transfer requested: ${describeAssignment(doc.from)} → ${describeAssignment(doc.to)}`,
    input.actor,
    {
      toStatus: doc.status,
      fromAssignment: doc.from,
      toAssignment: doc.to,
      reason: doc.reason,
      notes: doc.handoffNotes,
      metadata: { transferType: doc.transferType, urgency: doc.urgency },
    },
  ));

  const db = patientTransfersDB();
  const saved = withPendingOfflineSync(doc);
  const resp = await db.put(saved);
  saved._rev = resp.rev;

  await logAuditSafe(
    asDraft ? 'TRANSFER_DRAFTED' : 'TRANSFER_REQUESTED',
    input.actor?.id,
    input.actor?.name,
    // Structural facts only — who, what type, which assignment. The free-text
    // clinical reason stays in the transfer document's own event trail, which
    // is access-controlled with the chart. The audit log is push-synced and
    // read by operators who have no business seeing why a patient was moved,
    // and the house rule (see patient-service.mutatePatient) is field names,
    // never values.
    `${asDraft ? 'Drafted' : 'Requested'} ${doc.transferType} transfer ${doc._id} `
      + `of patient ${doc.patientId}: `
      + `${describeAssignment(doc.from)} → ${describeAssignment(doc.to)}`,
  );
  await emitSyncEvent({
    resourceType: 'patient_transfer',
    resourceId: saved._id,
    operation: 'create',
    resourceVersion: saved._rev,
    userId: input.actor?.id,
    username: input.actor?.name,
    orgId: saved.orgId,
    hospitalId: saved.hospitalId,
  });
  return saved;
}

/** Send a draft. Runs the same checklist gate as a direct send. */
export async function sendDraftTransfer(
  id: string,
  actor?: TransferActor,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (doc.status !== 'draft') {
    throw new TransferValidationError(`Only a draft can be sent (this one is ${doc.status})`);
  }
  const outstanding = outstandingChecklistItems(doc.checklist);
  if (outstanding.length > 0) {
    throw new TransferValidationError(
      `Complete the hand-off checklist before sending: ${outstanding.map(i => i.label).join(', ')}`,
    );
  }
  const now = new Date().toISOString();
  doc.status = 'requested';
  doc.requestedAt = now;
  doc.events.push(makeEvent(
    'TRANSFER_REQUESTED',
    `Transfer requested: ${describeAssignment(doc.from)} → ${describeAssignment(doc.to)}`,
    actor,
    { fromStatus: 'draft', toStatus: 'requested', fromAssignment: doc.from, toAssignment: doc.to },
  ));
  return persist(
    doc, 'TRANSFER_REQUESTED',
    `Sent transfer ${doc._id} for patient ${doc.patientId}`, actor,
  );
}

/**
 * Receiving side takes responsibility.
 *
 * An immediate transfer completes in the same call — accepting and then leaving
 * the assignment stale would mean the chart disagrees with the transfer record.
 * A future-dated one stays `accepted` until `effectiveAt` arrives (see
 * `applyDueTransfers`).
 */
export async function acceptTransfer(
  id: string,
  actor?: TransferActor,
  notes?: string,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (doc.status !== 'requested') {
    throw new TransferValidationError(`This transfer is ${doc.status} and cannot be accepted`);
  }

  const now = new Date().toISOString();
  doc.status = 'accepted';
  doc.decidedById = actor?.id;
  doc.decidedByName = actor?.name;
  doc.decidedAt = now;
  if (notes) doc.decisionNotes = notes;
  // The receiver's own identity is the most accurate destination we will ever
  // have: a transfer addressed to "Paediatrics" is answered by a specific
  // person, and the history should name them rather than the department.
  if (!doc.to.providerId && actor?.id) {
    doc.to = { ...doc.to, providerId: actor.id, providerName: actor.name };
  }
  doc.events.push(makeEvent(
    'TRANSFER_ACCEPTED',
    `Transfer accepted by ${actor?.name ?? 'receiving team'}`,
    actor,
    { fromStatus: 'requested', toStatus: 'accepted', toAssignment: doc.to, notes },
  ));

  const saved = await persist(
    doc, 'TRANSFER_ACCEPTED',
    `Accepted transfer ${doc._id} of patient ${doc.patientId} to ${describeAssignment(doc.to)}`,
    actor,
  );

  const dueNow = !saved.effectiveAt || new Date(saved.effectiveAt).getTime() <= Date.now();
  return dueNow ? (await completeTransfer(saved._id, actor)) ?? saved : saved;
}

export async function rejectTransfer(
  id: string,
  actor?: TransferActor,
  notes?: string,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (doc.status !== 'requested') {
    throw new TransferValidationError(`This transfer is ${doc.status} and cannot be rejected`);
  }
  // A rejection with no explanation leaves the sending clinician with a patient
  // back on their list and no idea what to fix before trying again.
  if (!notes || !notes.trim()) {
    throw new TransferValidationError('A reason is required when rejecting a transfer');
  }
  doc.status = 'rejected';
  doc.decidedById = actor?.id;
  doc.decidedByName = actor?.name;
  doc.decidedAt = new Date().toISOString();
  doc.decisionNotes = notes.trim();
  doc.events.push(makeEvent(
    'TRANSFER_REJECTED',
    `Transfer rejected by ${actor?.name ?? 'receiving team'}`,
    actor,
    { fromStatus: 'requested', toStatus: 'rejected', notes: doc.decisionNotes },
  ));
  return persist(
    doc, 'TRANSFER_REJECTED',
    // Rejection reason omitted deliberately: it is clinical free text and is
    // preserved on the transfer (`decisionNotes` + the TRANSFER_REJECTED event).
    `Rejected transfer ${doc._id} of patient ${doc.patientId}`, actor,
  );
}

export async function cancelTransfer(
  id: string,
  actor?: TransferActor,
  reason?: string,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (!OPEN_TRANSFER_STATUSES.has(doc.status)) {
    throw new TransferValidationError(`This transfer is ${doc.status} and cannot be cancelled`);
  }
  doc.status = 'cancelled';
  doc.cancelledById = actor?.id;
  doc.cancelledByName = actor?.name;
  doc.cancelledAt = new Date().toISOString();
  doc.events.push(makeEvent(
    'TRANSFER_CANCELLED',
    `Transfer withdrawn by ${actor?.name ?? 'sender'}`,
    actor,
    { toStatus: 'cancelled', reason },
  ));
  return persist(
    doc, 'TRANSFER_CANCELLED',
    `Cancelled transfer ${doc._id} of patient ${doc.patientId}${reason ? ` — ${reason}` : ''}`,
    actor,
  );
}

export async function addTransferNote(
  id: string,
  note: string,
  actor?: TransferActor,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (!note.trim()) throw new TransferValidationError('Note cannot be empty');
  doc.events.push(makeEvent('TRANSFER_NOTE_ADDED', note.trim(), actor, { notes: note.trim() }));
  return persist(doc, 'TRANSFER_NOTE_ADDED', `Note added to transfer ${doc._id}`, actor);
}

/** Update the operational part of a transfer without changing clinical ownership. */
export async function updateTransferLogistics(
  id: string,
  patch: {
    physicalStatus?: PatientTransferPhysicalStatus;
    destination?: PatientTransferLocation;
    transport?: PatientTransferTransport;
    clinicalReadiness?: PatientTransferClinicalReadiness;
    communication?: PatientTransferCommunication;
  },
  actor?: TransferActor,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (['rejected', 'cancelled', 'expired'].includes(doc.status)) {
    throw new TransferValidationError(`This transfer is ${doc.status} and cannot be updated`);
  }
  if (patch.destination?.bedId) {
    const wardDb = getDB('tamamhealth_wards');
    const bed = await wardDb.get(patch.destination.bedId) as BedDoc;
    if (bed.status !== 'available' && bed.currentPatientId !== doc.patientId) {
      throw new TransferValidationError('The selected bed is no longer available');
    }
    const reserved = withPendingOfflineSync({
      ...bed,
      status: 'reserved',
      currentPatientId: doc.patientId,
      currentPatientName: doc.patientName,
      currentAdmissionId: undefined,
      updatedAt: new Date().toISOString(),
    } satisfies BedDoc);
    const response = await wardDb.put(reserved);
    await emitSyncEvent({ resourceType: 'bed', resourceId: bed._id, operation: 'update', resourceVersion: response.rev, hospitalId: bed.facilityId });
  }
  doc.physicalStatus = patch.physicalStatus ?? doc.physicalStatus ?? 'not_scheduled';
  doc.destination = patch.destination ? { ...doc.destination, ...patch.destination } : doc.destination;
  doc.transport = patch.transport ? { ...doc.transport, ...patch.transport } : doc.transport;
  doc.clinicalReadiness = patch.clinicalReadiness
    ? { ...doc.clinicalReadiness, ...patch.clinicalReadiness }
    : doc.clinicalReadiness;
  doc.communication = patch.communication
    ? { ...doc.communication, ...patch.communication }
    : doc.communication;
  doc.events.push(makeEvent(
    'TRANSFER_LOGISTICS_UPDATED',
    `Transfer logistics updated${doc.physicalStatus ? `: ${doc.physicalStatus.replace(/_/g, ' ')}` : ''}`,
    actor,
    { metadata: { physicalStatus: doc.physicalStatus } },
  ));
  return persist(doc, 'TRANSFER_LOGISTICS_UPDATED', `Updated logistics for transfer ${doc._id}`, actor);
}

/** Confirm bedside arrival. Ownership and arrival are intentionally separate. */
export async function markTransferArrived(
  id: string,
  actor?: TransferActor,
  assessment?: PatientTransferClinicalReadiness,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (doc.status !== 'completed' && doc.status !== 'accepted') {
    throw new TransferValidationError('Only an accepted or completed transfer can arrive');
  }
  const now = new Date().toISOString();
  doc.physicalStatus = 'arrived';
  doc.arrivedAt = now;
  doc.arrivedById = actor?.id;
  doc.transport = doc.transport
    ? { ...doc.transport, status: 'arrived', arrivedAt: now }
    : { status: 'arrived', arrivedAt: now };
  doc.clinicalReadiness = {
    ...doc.clinicalReadiness,
    ...assessment,
    receiverAssessedAt: assessment?.receiverAssessedAt ?? now,
    receiverAssessedById: assessment?.receiverAssessedById ?? actor?.id,
  };
  doc.events.push(makeEvent(
    'TRANSFER_RECEIVING_ASSESSMENT',
    `Receiving team confirmed bedside arrival${actor?.name ? `: ${actor.name}` : ''}`,
    actor,
    { metadata: { physicalStatus: 'arrived' } },
  ));
  return persist(doc, 'TRANSFER_RECEIVING_ASSESSMENT', `Patient arrived for transfer ${doc._id}`, actor);
}

export async function closeTransfer(
  id: string,
  actor?: TransferActor,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (doc.status !== 'completed') throw new TransferValidationError('The transfer must be completed before it can be closed');
  if (doc.physicalStatus && !['arrived', 'receiving_assessment', 'closed'].includes(doc.physicalStatus)) {
    throw new TransferValidationError('Confirm patient arrival before closing the transfer');
  }
  const destinationFacilityId = doc.destination?.facilityId || doc.to.facilityId || doc.toHospitalId;
  if (destinationFacilityId && doc.hospitalId && destinationFacilityId !== doc.hospitalId) {
    if (doc.clinicalReadiness?.medicationsReconciled !== true) {
      throw new TransferValidationError('Reconcile medications before closing an inter-facility inpatient transfer');
    }
    const { closeAdmissionForTransfer, getActiveAdmissions } = await import('./ward-service');
    const admission = (await getActiveAdmissions()).find(row =>
      row.patientId === doc.patientId && row.facilityId === doc.hospitalId
    );
    if (admission) {
      await closeAdmissionForTransfer(admission._id, {
        id: doc._id,
        destinationName: doc.destination?.facilityName || doc.to.facilityName || destinationFacilityId,
        reason: doc.reason,
        actorId: actor?.id,
        actorName: actor?.name,
      });
    }
  }
  const now = new Date().toISOString();
  doc.physicalStatus = 'closed';
  doc.closedAt = now;
  doc.closedById = actor?.id;
  doc.events.push(makeEvent('TRANSFER_RECEIVING_ASSESSMENT', 'Transfer closed after receiving assessment', actor, {
    metadata: { physicalStatus: 'closed' },
  }));
  return persist(doc, 'TRANSFER_CLOSED', `Closed transfer ${doc._id}`, actor);
}

/** Tick or untick hand-off checklist items on an unsent/pending transfer. */
export async function updateTransferChecklist(
  id: string,
  updates: Array<{ key: string; done: boolean }>,
  actor?: TransferActor,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (DECIDED_STATUSES.has(doc.status)) {
    throw new TransferValidationError(
      `This transfer is ${doc.status}; its checklist is now part of the record and cannot change`,
    );
  }
  const now = new Date().toISOString();
  const byKey = new Map(updates.map(u => [u.key, u.done]));
  doc.checklist = (doc.checklist ?? defaultChecklist()).map(item => {
    if (!byKey.has(item.key)) return item;
    const done = byKey.get(item.key)!;
    return {
      ...item,
      done,
      completedAt: done ? now : undefined,
      completedById: done ? actor?.id : undefined,
    };
  });
  const doneCount = doc.checklist.filter(i => i.done).length;
  doc.events.push(makeEvent(
    'TRANSFER_CHECKLIST_UPDATED',
    `Hand-off checklist updated (${doneCount}/${doc.checklist.length} complete)`,
    actor,
    { metadata: { done: doneCount, total: doc.checklist.length } },
  ));
  return persist(doc, 'TRANSFER_CHECKLIST_UPDATED', `Checklist updated on transfer ${doc._id}`, actor);
}

// ── Applying ownership ───────────────────────────────────────────────────

/**
 * The only place `patient.assignedDoctor` / `careTeam` are written by this
 * module. Uses `mutatePatient`'s read-modify-write retry so a concurrent chart
 * edit cannot silently drop the assignment change (or vice versa).
 *
 * Semantics per transfer type:
 *   permanent   — the destination becomes the owner outright.
 *   temporary   — the destination becomes the owner, and the displaced owner is
 *                 parked on the care team as `previous_owner` with the grant's
 *                 expiry, so `applyDueTransfers` can hand the patient back.
 *   shared_care — ownership is NOT touched; the destination is added to the
 *                 care team as a `consult`.
 */
async function applyAssignment(t: PatientTransferDoc): Promise<void> {
  const { mutatePatient } = await import('./patient-service');
  const now = new Date().toISOString();

  const updated = await mutatePatient(t.patientId, (patient) => {
    // Drop lapsed grants on every write — an expired entry that lingers reads
    // as live access to anything that forgets to check the date.
    const team = activeCareTeam(patient).filter(m => m.transferId !== t._id);

    if (t.transferType === 'shared_care') {
      if (!t.to.providerId) return null;
      team.push({
        providerId: t.to.providerId,
        providerName: t.to.providerName,
        department: t.to.department,
        facilityId: t.to.facilityId,
        role: 'consult',
        transferId: t._id,
        grantedAt: now,
        expiresAt: t.expiresAt,
      });
      return { careTeam: team };
    }

    if (t.transferType === 'temporary' && patient.assignedDoctor) {
      team.push({
        providerId: patient.assignedDoctor,
        providerName: patient.assignedDoctorName,
        department: patient.assignedDepartment,
        facilityId: t.from.facilityId,
        role: 'previous_owner',
        transferId: t._id,
        grantedAt: now,
        expiresAt: t.expiresAt,
      });
    }

    return {
      assignedDoctor: t.to.providerId ?? patient.assignedDoctor,
      assignedDoctorName: t.to.providerName ?? patient.assignedDoctorName,
      assignedDepartment: t.to.department ?? patient.assignedDepartment,
      assignedAt: now,
      assignedBy: t.decidedById ?? t.requestedById,
      assignedByName: t.decidedByName ?? t.requestedByName,
      assignmentNote: t.handoffNotes,
      careTeam: team,
    };
  });

  // `mutatePatient` returns null when the patient record cannot be found. If
  // that is swallowed, `completeTransfer` goes on to stamp the transfer
  // `completed` — a record asserting that ownership moved, over a chart that
  // was never written. Throwing keeps the transfer in `accepted` so it can be
  // retried and so the sweep reports it, which is the whole point of doing the
  // assignment BEFORE the status change.
  if (!updated) {
    throw new Error(
      `Cannot apply transfer ${t._id}: patient ${t.patientId} could not be updated `
      + '(record missing or deleted)',
    );
  }
}

/**
 * Move the patient's open tasks to the receiving provider.
 *
 * A transfer that moves the name on the chart but leaves the outstanding work
 * queued to someone who is no longer responsible is how follow-ups get dropped;
 * moving ownership without moving the work is the failure this exists to
 * prevent. Shared-care grants are excluded — the owner keeps their own tasks.
 * Best-effort: a task-reassignment failure must not roll back a completed
 * transfer, so it is logged into the transfer's own history instead.
 */
async function reassignOpenTasks(
  t: PatientTransferDoc,
  actor?: TransferActor,
): Promise<string[]> {
  if (t.transferType === 'shared_care' || !t.to.providerId) return [];
  const moved: string[] = [];
  try {
    const db = clinicianTasksDB();
    const tasks = await findByType<ClinicianTaskDoc>(
      db, 'clinician_task', { patientId: t.patientId }, { indexFields: ['type', 'patientId'] },
    );
    for (const task of tasks) {
      if (task.status !== 'open') continue;
      if (task.userId === t.to.providerId) continue;
      const resp = await db.put(withPendingOfflineSync({
        ...task,
        userId: t.to.providerId,
        updatedAt: new Date().toISOString(),
      }));
      moved.push(task._id);
      void resp;
    }
  } catch (err) {
    console.warn(`[transfer] task reassignment failed for ${t._id}:`, err);
  }
  if (moved.length > 0) {
    await logAuditSafe(
      'TRANSFER_TASKS_REASSIGNED', actor?.id, actor?.name,
      `Reassigned ${moved.length} open task(s) for patient ${t.patientId} to ${t.to.providerName ?? t.to.providerId}`,
    );
  }
  return moved;
}

/**
 * Close the hand-off: move ownership, move the work, stamp the record.
 *
 * Ordering matters. The assignment and the tasks move BEFORE the doc is marked
 * `completed`, so a failure part-way leaves a transfer that still reads as
 * `accepted` and can be retried — rather than one that claims to be complete
 * over a chart that never changed.
 */
export async function completeTransfer(
  id: string,
  actor?: TransferActor,
): Promise<PatientTransferDoc | null> {
  const doc = await getTransferById(id);
  if (!doc) return null;
  if (doc.status !== 'accepted') {
    throw new TransferValidationError(
      `Only an accepted transfer can be completed (this one is ${doc.status})`,
    );
  }

  const previousOwner: PatientTransferAssignment = { ...doc.from };
  await applyAssignment(doc);
  const movedTasks = await reassignOpenTasks(doc, actor);

  const now = new Date().toISOString();
  doc.status = 'completed';
  doc.completedAt = now;
  if (!doc.effectiveAt) doc.effectiveAt = now;
  if (movedTasks.length) doc.reassignedTaskIds = movedTasks;

  doc.events.push(makeEvent(
    'TRANSFER_COMPLETED',
    doc.transferType === 'shared_care'
      ? `${describeAssignment(doc.to)} added to the care team`
      : `Care ownership moved to ${describeAssignment(doc.to)}`,
    actor,
    {
      fromStatus: 'accepted',
      toStatus: 'completed',
      fromAssignment: previousOwner,
      toAssignment: doc.to,
      metadata: { reassignedTasks: movedTasks.length, transferType: doc.transferType },
    },
  ));
  if (movedTasks.length) {
    doc.events.push(makeEvent(
      'TRANSFER_TASKS_REASSIGNED',
      `${movedTasks.length} open task(s) moved to ${doc.to.providerName ?? 'the receiving provider'}`,
      actor,
      { metadata: { count: movedTasks.length } },
    ));
  }

  return persist(
    doc, 'TRANSFER_COMPLETED',
    `Completed ${doc.transferType} transfer ${doc._id} of patient ${doc.patientId}: `
      + `${describeAssignment(previousOwner)} → ${describeAssignment(doc.to)}`,
    actor,
  );
}

/**
 * Option 1 — direct transfer. Ownership moves immediately with no acceptance
 * step. Gated by `patient.transfer.force` at the API boundary; recorded with
 * `forced: true` so these are auditable as a class rather than being
 * indistinguishable from transfers a receiver actually agreed to.
 */
export async function forceTransfer(
  input: CreateTransferInput,
): Promise<PatientTransferDoc> {
  const created = await createTransferRequest({
    ...input,
    // The force path skips the acceptance gate, not the reason requirement;
    // the checklist gate is skipped because there is no sending clinician
    // working through it — an admin reassignment is not a bedside hand-off.
    checklist: input.checklist ?? defaultChecklist().map(i => ({ ...i, done: true })),
    // A forced transfer is applied immediately by definition, so it can never
    // be a draft — honouring `asDraft` here would produce a "completed" doc
    // with no `requestedAt`, i.e. a hole in the very trail this path most needs.
    asDraft: false,
  });

  const now = new Date().toISOString();
  created.forced = true;
  created.status = 'accepted';
  created.decidedById = input.actor?.id;
  created.decidedByName = input.actor?.name;
  created.decidedAt = now;
  created.events.push(makeEvent(
    'TRANSFER_REASSIGNED',
    `Transfer applied directly by ${input.actor?.name ?? 'an administrator'} without receiving-team acceptance`,
    input.actor,
    { fromStatus: 'requested', toStatus: 'accepted', toAssignment: created.to },
  ));
  const accepted = await persist(
    created, 'TRANSFER_REASSIGNED',
    `Force-transferred patient ${created.patientId} to ${describeAssignment(created.to)}`,
    input.actor,
  );
  return (await completeTransfer(accepted._id, input.actor)) ?? accepted;
}

// ── Scheduled + expiring transfers ───────────────────────────────────────

/**
 * Sweep for transfers whose clock has run out. Idempotent — safe to run on
 * every page load, on a cron, or both.
 *
 *  - Accepted + `effectiveAt` reached + `autoCompleteOnEffectiveDate` → complete.
 *  - Completed temporary transfer past `expiresAt` → hand the patient back to
 *    the parked previous owner and mark the transfer `expired`.
 *  - Completed shared-care grant past `expiresAt` → mark `expired`; the lapsed
 *    care-team entry is already inert (`activeCareTeam` filters on date) and is
 *    swept off the chart here.
 *
 * Returns what it changed so a caller can report it rather than guess.
 */
export async function applyDueTransfers(
  now: Date = new Date(),
  actor?: TransferActor,
): Promise<{
  completed: string[];
  expired: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  const completed: string[] = [];
  const expired: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const nowIso = now.toISOString();
  const db = patientTransfersDB();
  // The hourly job used to read and sort every transfer ever created, even
  // when zero were due. On a remote CouchDB that makes runtime grow with the
  // lifetime of the installation and can exceed the scheduler timeout. Ask
  // the database only for the two indexed state/time windows this sweep acts
  // on. The final predicates retain the domain rules that do not belong in a
  // Mango index (`autoCompleteOnEffectiveDate` and transfer type).
  const [acceptedDue, completedDue] = await Promise.all([
    findByType<PatientTransferDoc>(
      db,
      'patient_transfer',
      { status: 'accepted', effectiveAt: { $lte: nowIso } },
      { indexFields: ['type', 'status', 'effectiveAt'] },
    ),
    findByType<PatientTransferDoc>(
      db,
      'patient_transfer',
      { status: 'completed', expiresAt: { $lte: nowIso } },
      { indexFields: ['type', 'status', 'expiresAt'] },
    ),
  ]);
  const all = [
    ...acceptedDue.filter(t => t.autoCompleteOnEffectiveDate !== false && Boolean(t.effectiveAt)),
    ...completedDue.filter(t => t.transferType !== 'permanent' && Boolean(t.expiresAt)),
  ];

  for (const t of all) {
    try {
      if (t.status === 'accepted'
          && t.autoCompleteOnEffectiveDate !== false
          && t.effectiveAt
          && new Date(t.effectiveAt).getTime() <= now.getTime()) {
        await completeTransfer(t._id, actor);
        completed.push(t._id);
        continue;
      }
      if (t.status === 'completed'
          && t.transferType !== 'permanent'
          && t.expiresAt
          && new Date(t.expiresAt).getTime() <= now.getTime()) {
        await expireTransfer(t, actor);
        expired.push(t._id);
      }
    } catch (err) {
      // One bad transfer must not stop the sweep for every other patient — but
      // it must not vanish either. A swallowed failure here means a scheduled
      // transfer silently never lands, or a lapsed grant keeps its access, and
      // the run still reports success. Collect it so the caller (and the cron)
      // can fail loudly on a non-empty list.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[transfer] due-sweep failed for ${t._id}: ${message}`);
      failed.push({ id: t._id, error: message });
    }
  }
  return { completed, expired, failed };
}

/** Lapse a temporary/shared-care grant and return ownership if it had moved. */
async function expireTransfer(
  t: PatientTransferDoc,
  actor?: TransferActor,
): Promise<PatientTransferDoc | null> {
  const { mutatePatient } = await import('./patient-service');
  const nowIso = new Date().toISOString();

  await mutatePatient(t.patientId, (patient) => {
    const parked = (patient.careTeam ?? []).find(
      m => m.transferId === t._id && m.role === 'previous_owner',
    );
    const team = (patient.careTeam ?? []).filter(m => m.transferId !== t._id);

    // Only hand back if the temporary holder is still the owner. If ownership
    // has since moved on to someone else, reverting would silently undo a
    // later, deliberate transfer.
    if (parked && patient.assignedDoctor === t.to.providerId) {
      return {
        assignedDoctor: parked.providerId,
        assignedDoctorName: parked.providerName,
        assignedDepartment: parked.department,
        assignedAt: nowIso,
        careTeam: team,
      };
    }
    return { careTeam: team };
  });

  const doc = await getTransferById(t._id);
  if (!doc) return null;
  doc.status = 'expired';
  doc.events.push(makeEvent(
    'TRANSFER_EXPIRED',
    doc.transferType === 'shared_care'
      ? `Shared-care access for ${describeAssignment(doc.to)} lapsed`
      : `Temporary transfer lapsed; care returned to ${describeAssignment(doc.from)}`,
    actor,
    { fromStatus: 'completed', toStatus: 'expired', fromAssignment: doc.to, toAssignment: doc.from },
  ));
  return persist(
    doc, 'TRANSFER_EXPIRED',
    `Expired ${doc.transferType} transfer ${doc._id} for patient ${doc.patientId}`, actor,
  );
}

/**
 * The banner state for a patient chart: the live transfer a viewer needs to
 * know about, if any. Returns the pending request first (someone must act),
 * otherwise an in-force temporary/shared-care grant (access is time-boxed).
 */
export async function getActiveTransferForPatient(
  patientId: string,
  scope?: DataScope,
  viewerId?: string,
): Promise<PatientTransferDoc | null> {
  const rows = await getTransfersByPatient(patientId, scope, viewerId);
  const pending = rows.find(t => t.status === 'requested' || t.status === 'accepted');
  if (pending) return pending;
  const now = Date.now();
  return rows.find(t =>
    t.status === 'completed'
    && t.transferType !== 'permanent'
    && t.expiresAt
    && new Date(t.expiresAt).getTime() > now) ?? null;
}
