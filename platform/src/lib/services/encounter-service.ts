/**
 * Clinical encounter service — persists and transitions an in-progress
 * consultation through the documented patient-journey state machine
 * (lib/clinical-flow/encounter-journey.ts). This is what lets a clinician
 * order labs, pause the visit (`awaiting_labs`), and resume it when results
 * return, instead of finalising everything in one shot.
 *
 * Transitions are validated against `canTransition()` so the system can only
 * move an encounter the way the architecture document allows.
 */
import { v4 as uuidv4 } from 'uuid';
import { encountersDB } from '../db';
import type { EncounterDoc, UserRole } from '../db-types';
import {
  canTransition, stageOf, isTerminal, TERMINAL_STATUSES, type EncounterStatus,
} from '../clinical-flow/encounter-journey';
import {
  ACTION_CAPABILITY, capabilitiesForUserRole, satisfiesRequirement,
} from '../clinical-flow/capabilities';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { appointmentStatusForEncounter, nonRegressingAppointmentStatus } from '../clinical-flow/visit-state';

/** Statuses where the clinician has handed off and is waiting on a parallel order. */
export const RESUMABLE_STATUSES: EncounterStatus[] = [
  'awaiting_labs',
  'awaiting_imaging',
  'consultation_paused_draft',
];

/**
 * Statuses that close the CLINIC portion of a visit even though they are not
 * themselves terminal (KAN-100 audit). Hoisted to module scope — and
 * exported — so `checkout-gate-service.ts` can derive "is this visit still
 * open" from the same set `transitionEncounter` uses to stamp `closedAt`,
 * instead of maintaining a second hand-list that can drift from this one.
 */
export const CLOSES_CLINIC_PORTION: EncounterStatus[] = ['ready_for_clinic_checkout', 'referred_out'];

/**
 * Current shape of `EncounterDoc.snapshot`.
 *
 * Bump this whenever the consultation draft changes shape in a way that older
 * drafts cannot satisfy, and add the corresponding step to
 * `migrateEncounterSnapshot` below.
 */
export const CURRENT_SNAPSHOT_VERSION = 1;

/**
 * Bring a stored consultation draft up to `CURRENT_SNAPSHOT_VERSION`.
 *
 * An encounter can be paused on one app version and resumed on another — the
 * clinician sends the patient to the lab, the facility updates overnight, and
 * the draft is reopened against a newer consultation form. Before this existed,
 * a structurally incompatible snapshot was spread onto the current form fields
 * with no signal that anything was wrong.
 *
 * Documents written before `snapshotVersion` existed are treated as version 1,
 * which is correct: version 1 *is* the shape they were written in.
 *
 * Migrations must be pure and defensive — they run against real clinical drafts
 * that may be partially filled or hand-edited by a sync conflict resolution.
 */
export function migrateEncounterSnapshot(
  snapshot: Record<string, unknown> | undefined,
  fromVersion: number | undefined,
): { snapshot: Record<string, unknown>; version: number; migrated: boolean } {
  const current = snapshot ?? {};
  const version = fromVersion ?? 1;

  if (version === CURRENT_SNAPSHOT_VERSION) {
    return { snapshot: current, version, migrated: false };
  }

  if (version > CURRENT_SNAPSHOT_VERSION) {
    // Written by a NEWER app version than this one. Do not attempt to
    // down-convert — dropping fields we don't understand would silently
    // discard clinical data. Hand it back untouched and let the form ignore
    // what it doesn't recognise.
    console.warn(
      `[encounter] snapshot version ${version} is newer than supported ${CURRENT_SNAPSHOT_VERSION}; leaving as-is`,
    );
    return { snapshot: current, version, migrated: false };
  }

  // ---------------------------------------------------------------------
  // Upgrade chain. Each step takes vN → vN+1. No steps yet: version 1 is the
  // first defined shape. When the draft shape next changes, add:
  //
  //   let working = current;
  //   if (working.__version < 2) { working = upgradeV1toV2(working); }
  //
  // and bump CURRENT_SNAPSHOT_VERSION.
  // ---------------------------------------------------------------------
  return { snapshot: current, version: CURRENT_SNAPSHOT_VERSION, migrated: true };
}

export async function getEncounter(id: string): Promise<EncounterDoc | null> {
  try {
    return await encountersDB().get(id) as EncounterDoc;
  } catch {
    return null;
  }
}

export async function getAllEncounters(scope?: DataScope): Promise<EncounterDoc[]> {
  const rows = await findByType<EncounterDoc>(encountersDB(), 'clinical_encounter', {}, { indexFields: ['type'] });
  rows.sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  return scope ? filterByScope(rows, scope) : rows;
}

/** Indexed encounter read bounded to a half-open instant range. */
export async function getEncountersInRange(
  range: { from: string; to: string },
  scope: DataScope,
): Promise<EncounterDoc[]> {
  const db = encountersDB();
  const operator = { $gte: range.from, $lt: range.to };
  const [byStart, byCreated] = await Promise.all([
    findByType<EncounterDoc>(db, 'clinical_encounter', { startedAt: operator }, { indexFields: ['type', 'startedAt'] }),
    findByType<EncounterDoc>(db, 'clinical_encounter', { createdAt: operator }, { indexFields: ['type', 'createdAt'] }),
  ]);
  const unique = new Map([...byStart, ...byCreated].map(encounter => [encounter._id, encounter]));
  const rows = [...unique.values()].filter(encounter => {
    const at = encounter.startedAt || encounter.createdAt;
    return !!at && at >= range.from && at < range.to;
  });
  return filterByScope(rows, scope);
}

/** Completed encounters in a bounded close-time window, for billing/ops views. */
export async function getEncountersClosedSince(
  since: string,
  statuses: EncounterStatus[],
  scope?: DataScope,
): Promise<EncounterDoc[]> {
  if (statuses.length === 0) return [];
  const db = encountersDB();
  const groups = await Promise.all(statuses.map(status => findByType<EncounterDoc>(
    db,
    'clinical_encounter',
    { status, closedAt: { $gte: since } },
    { indexFields: ['type', 'status', 'closedAt'] },
  )));
  const rows = groups.flat().filter(encounter => !!encounter.closedAt && encounter.closedAt >= since);
  const visible = scope ? filterByScope(rows, scope) : rows;
  return visible.sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
}

/**
 * Open (non-closed) encounters a clinician can resume, newest first.
 *
 * `clinicianId` is required (KAN-?? audit): a falsy id used to fall through to
 * "every clinician's paused encounters", which is how a hook mid-hydration (no
 * signed-in user yet) briefly listed every open encounter in the replica.
 * `scope` is applied like every other multi-tenant read in this module — a
 * device replicates every org it has synced, and without it a clinician whose
 * `_id` happened to collide across tenants (or a stale/shared session) could
 * resume a visit that is not theirs.
 */
export async function getResumableEncounters(clinicianId: string, scope?: DataScope): Promise<EncounterDoc[]> {
  if (!clinicianId) return [];
  const rows = await findByType<EncounterDoc>(encountersDB(), 'clinical_encounter', {}, { indexFields: ['type'] });
  const visible = scope ? filterByScope(rows, scope) : rows;
  return visible
    .filter(e => !e.closedAt && RESUMABLE_STATUSES.includes(e.status))
    .filter(e => e.clinicianId === clinicianId)
    .sort((a, b) => new Date(b.updatedAt || '').getTime() - new Date(a.updatedAt || '').getTime());
}

/** Create a new in-progress encounter (defaults to `with_clinician`). */
export async function createEncounter(
  data: Omit<EncounterDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'stageKey'> & { status?: EncounterStatus },
): Promise<EncounterDoc> {
  const db = encountersDB();
  const now = new Date().toISOString();
  const status: EncounterStatus = data.status ?? 'with_clinician';
  const doc: EncounterDoc = {
    _id: `enc-${uuidv4()}`,
    type: 'clinical_encounter',
    ...data,
    status,
    stageKey: stageOf(status),
    // Seed the trail with the creating transition. The spec models this as
    // `from: null` — the visit came into existence at this status — and without
    // it a trail read back later starts mid-journey, with no record of which
    // door the patient came in through.
    statusHistory: data.statusHistory ?? [{
      from: null,
      to: status,
      at: now,
      byUserId: data.createdBy ?? data.clinicianId,
    }],
    snapshotVersion: CURRENT_SNAPSHOT_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc as unknown as Record<string, unknown>);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_ENCOUNTER', data.clinicianId, undefined, `Encounter ${doc._id} for ${data.patientName} (${status})`);
  emitSyncEvent({ resourceType: 'clinical_encounter', resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, orgId: doc.orgId, hospitalId: doc.hospitalId });
  return doc;
}

/** Patch an encounter's snapshot / lab order ids without changing status. */
export async function updateEncounter(id: string, patch: Partial<EncounterDoc>): Promise<EncounterDoc | null> {
  const db = encountersDB();
  try {
    const existing = await db.get(id) as EncounterDoc;
    // Any write re-stamps the version: the snapshot being persisted is
    // produced by *this* app version, whatever shape it was read in.
    const updated: EncounterDoc = {
      ...existing,
      ...patch,
      _id: existing._id,
      _rev: existing._rev,
      type: 'clinical_encounter',
      ...(patch.snapshot ? { snapshotVersion: CURRENT_SNAPSHOT_VERSION } : {}),
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated as unknown as Record<string, unknown>);
    updated._rev = resp.rev;
    emitSyncEvent({ resourceType: 'clinical_encounter', resourceId: id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.hospitalId });
    return updated;
  } catch {
    return null;
  }
}

/**
 * Move an encounter to a new status, enforcing the journey state machine.
 * Throws if the transition is not allowed by the architecture document.
 */
export async function transitionEncounter(
  id: string,
  to: EncounterStatus,
  opts?: { snapshot?: Record<string, unknown>; labOrderIds?: string[]; medicalRecordId?: string; actorId?: string; actorRole?: UserRole; reason?: string },
): Promise<EncounterDoc> {
  const db = encountersDB();
  const existing = await db.get(id) as EncounterDoc;
  if (existing.status !== to && !canTransition(existing.status, to)) {
    throw new Error(`Illegal encounter transition: ${existing.status} → ${to}`);
  }
  // Capability check — WARN-ONLY for now (step 1 of the engine migration):
  // callers that pass `actorRole` get a recorded governance signal when the
  // move needs a capability the role does not hold, without breaking the
  // legitimate catch-up chains (advanceEncounterToClinician etc.) that walk
  // stations on the system's behalf. Once call sites pass roles and the audit
  // trail shows no legitimate violations, this flips to a hard refusal.
  if (opts?.actorRole && existing.status !== to) {
    const required = ACTION_CAPABILITY[to];
    if (!satisfiesRequirement(capabilitiesForUserRole(opts.actorRole), required)) {
      await logAuditSafe(
        'ENCOUNTER_CAPABILITY_WARN',
        opts.actorId,
        undefined,
        `Encounter ${id}: ${existing.status} → ${to} performed by role '${opts.actorRole}' lacking capability ${JSON.stringify(required)}`,
      );
    }
  }
  const now = new Date().toISOString();
  // Derived from TERMINAL_STATUSES rather than hand-listed (KAN-100 audit).
  // The old literal list named 'admitted' and 'deceased' but omitted
  // 'discharged', 'discharged_with_referral', 'discharged_with_pending_items',
  // 'dismissed_without_formal_checkout' and 'lwbs' — so a normally-discharged
  // encounter never got a closedAt. That matters because payments/page.tsx
  // groups by `closedAt || startedAt`, which silently dated a multi-day visit's
  // billing to the ARRIVAL day. Deriving it means a new terminal status is
  // covered automatically instead of needing this line edited too.
  //
  // The two non-terminal statuses kept from the original list still stamp it:
  // they close the CLINIC portion of the visit, which is what the front-desk
  // and payment views are grouping on.
  const closed = TERMINAL_STATUSES.includes(to) || CLOSES_CLINIC_PORTION.includes(to);
  const updated: EncounterDoc = {
    ...existing,
    status: to,
    stageKey: stageOf(to),
    snapshot: opts?.snapshot ?? existing.snapshot,
    labOrderIds: opts?.labOrderIds ?? existing.labOrderIds,
    medicalRecordId: opts?.medicalRecordId ?? existing.medicalRecordId,
    closedAt: closed ? now : existing.closedAt,
    // Append the hop to the visit's own trail. A no-op re-transition (status
    // already `to`) is not appended: repeating a status is not a movement, and
    // recording it would make an idempotent call look like a second visit leg.
    statusHistory: existing.status === to
      ? existing.statusHistory
      : [
        ...(existing.statusHistory ?? []),
        {
          from: existing.status,
          to,
          at: now,
          byUserId: opts?.actorId ?? existing.clinicianId,
          ...(opts?.reason ? { reason: opts.reason } : {}),
        },
      ],
    updatedAt: now,
    _id: existing._id,
    _rev: existing._rev,
    type: 'clinical_encounter',
  };
  const resp = await db.put(updated as unknown as Record<string, unknown>);
  updated._rev = resp.rev;
  await logAuditSafe('TRANSITION_ENCOUNTER', opts?.actorId ?? existing.clinicianId, undefined, `Encounter ${id}: ${existing.status} → ${to}`);
  emitSyncEvent({ resourceType: 'clinical_encounter', resourceId: id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.hospitalId });
  if (updated.appointmentId) {
    const repairId = `repair-encounter-projection-${updated._id}`;
    try {
      const { getAppointmentById, updateAppointmentStatus } = await import('./appointment-service');
      const appointment = await getAppointmentById(updated.appointmentId);
      const projectedStatus = appointment
        ? nonRegressingAppointmentStatus(appointment.status, appointmentStatusForEncounter(updated.status))
        : appointmentStatusForEncounter(updated.status);
      if (appointment && appointment.status !== projectedStatus) {
        const projected = await updateAppointmentStatus(appointment._id, projectedStatus, {
          actorId: opts?.actorId,
          actorRole: opts?.actorRole,
          note: `Projected from encounter stage ${updated.status}`,
        });
        if (!projected) throw new Error('Appointment projection write failed');
      }
      const { resolveWorkflowRepair } = await import('./workflow-repair-service');
      await resolveWorkflowRepair(repairId).catch(() => undefined);
    } catch (error) {
      const { upsertWorkflowRepair } = await import('./workflow-repair-service');
      await upsertWorkflowRepair(repairId, {
        workflow: 'encounter_projection',
        patientId: updated.patientId,
        appointmentId: updated.appointmentId,
        encounterId: updated._id,
        hospitalId: updated.hospitalId,
        orgId: updated.orgId,
        status: 'open',
        currentStep: 'appointment_status',
        lastError: error instanceof Error ? error.message : 'Appointment projection failed',
      }).catch(() => undefined);
    }
  }
  return updated;
}

/**
 * Resolve an externally-supplied encounter id (URL param, form state) into an
 * encounter ONLY when it provably belongs to the named patient — and, when a
 * scope is given, to the caller's org/facility. Everything else resolves to
 * null so the caller drops the link instead of acting on it.
 *
 * Exists because two flows (death registration, ward admission) took
 * `?encounterId=` at face value and drove TERMINAL transitions with it: a
 * stale param surviving a patient swap closed a different — living, mid-visit
 * — patient's encounter as deceased/admitted. An encounter id is a claim, not
 * a fact; this is where the claim gets checked.
 */
export async function resolvePatientEncounter(
  encounterId: string,
  patientId: string,
  scope?: { orgId?: string; hospitalId?: string; role: string },
): Promise<EncounterDoc | null> {
  if (!encounterId || !patientId) return null;
  const enc = await getEncounter(encounterId);
  if (!enc) return null;
  if (enc.patientId !== patientId) return null;
  if (scope) {
    const { filterByScope } = await import('./data-scope');
    if (filterByScope([enc], scope as DataScope).length === 0) return null;
  }
  return enc;
}

/** The most recent still-open (non-terminal) encounter for a patient, or null. */
export async function getOpenEncounterForPatient(patientId: string): Promise<EncounterDoc | null> {
  const rows = await findByType<EncounterDoc>(
    encountersDB(), 'clinical_encounter', { patientId }, { indexFields: ['type', 'patientId'] },
  );
  const open = rows.filter(e => !isTerminal(e.status));
  open.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return open[0] ?? null;
}

/** How recent an encounter must be to count as "the same visit" for reuse. */
const OPEN_ENCOUNTER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * The newest open (non-terminal) encounter for a patient created within the
 * last 24h — the visit an arriving or consulting patient should be joined to
 * instead of spawning a duplicate encounter for the same episode of care.
 * Unlike `getOpenEncounterForPatient`, this is time-bounded so a stale open
 * encounter from days ago (abandoned without a formal close) never silently
 * absorbs an unrelated new visit.
 *
 * `hospitalId` is required: within an org every facility replicates the same
 * encounter DB, so an unscoped join would let Facility B's check-in absorb a
 * still-open encounter created at Facility A — writing B's triage and consult
 * activity onto an A-owned visit (cross-facility record mixing). A patient
 * presenting at a different facility gets a fresh encounter there instead.
 */
export async function findOpenEncounterForPatient(patientId: string, hospitalId: string): Promise<EncounterDoc | null> {
  const rows = await findByType<EncounterDoc>(
    encountersDB(), 'clinical_encounter', { patientId }, { indexFields: ['type', 'patientId'] },
  );
  const cutoff = Date.now() - OPEN_ENCOUNTER_LOOKBACK_MS;
  const open = rows.filter(e =>
    !isTerminal(e.status) &&
    e.hospitalId === hospitalId &&
    new Date(e.createdAt || e.startedAt || 0).getTime() >= cutoff,
  );
  open.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return open[0] ?? null;
}

/**
 * True if the patient has ever had an encounter reach a terminal status.
 * Used to auto-derive `attendanceType` (new vs repeat) at arrival.
 */
export async function hasClosedEncounterForPatient(patientId: string): Promise<boolean> {
  const rows = await findByType<EncounterDoc>(
    encountersDB(), 'clinical_encounter', { patientId }, { indexFields: ['type', 'patientId'] },
  );
  return rows.some(e => isTerminal(e.status));
}

export interface CreateArrivalEncounterInput {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  /** How the patient arrived — stamped on the encounter as its front door. */
  arrivalChannel: 'appointment' | 'walk_in' | 'referral';
  /** The scheduled appointment this arrival matched, when one existed. */
  appointmentId?: string;
  attendanceType?: 'new' | 'repeat';
  /** Acting front-desk user, for the audit trail. */
  actorId?: string;
}

/**
 * Create the encounter at the moment a patient arrives at the facility — the
 * visit id that threads registration/check-in/triage together instead of the
 * former patientId-only joins (docs/EMR-FIELD-AUDIT-2026-07.md §1 and §3).
 *
 * No clinician is assigned yet at arrival, so `clinicianId`/`clinicianName`
 * are stamped empty and filled in once the patient is routed to one.
 *
 * The encounter is created at the legal Stage 1-2 entry status for its
 * arrival channel and then walked, hop by hop through `transitionEncounter`
 * (so every move is validated and audited exactly like any other transition),
 * to `awaiting_triage`:
 *   - walk-in / referral: arrived_at_facility → awaiting_next_station → awaiting_triage
 *   - appointment:        registered → arrived_at_facility → awaiting_next_station → awaiting_triage
 */
export async function createArrivalEncounter(input: CreateArrivalEncounterInput): Promise<EncounterDoc> {
  const now = new Date().toISOString();
  const initialStatus: EncounterStatus = input.arrivalChannel === 'appointment' ? 'registered' : 'arrived_at_facility';
  const linkedAppointment = input.appointmentId
    ? await import('./appointment-service').then(module => module.getAppointmentById(input.appointmentId!))
    : null;
  let enc = await createEncounter({
    patientId: input.patientId,
    patientName: input.patientName,
    hospitalNumber: input.hospitalNumber,
    clinicianId: '',
    clinicianName: '',
    assignedClinicianId: linkedAppointment?.providerId || undefined,
    assignedClinicianName: linkedAppointment?.providerName || undefined,
    assignedNurseId: linkedAppointment?.staffId,
    assignedNurseName: linkedAppointment?.staffName,
    assignedAt: linkedAppointment?.providerId || linkedAppointment?.staffId ? now : undefined,
    // Who opened the visit. An arrival has no clinician yet, so without this
    // the very first entry in the trail — the moment the patient was admitted
    // at the front desk — was the one hop with nobody's name against it, while
    // every later hop carried the actor this same call already knows.
    createdBy: input.actorId,
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    status: initialStatus,
    snapshot: {},
    labOrderIds: [],
    startedAt: now,
    orgId: input.orgId,
    attendanceType: input.attendanceType,
    arrivalChannel: input.arrivalChannel,
    appointmentId: input.appointmentId,
  });
  const remainingHops: EncounterStatus[] = initialStatus === 'registered'
    ? ['arrived_at_facility', 'awaiting_next_station', 'awaiting_triage']
    : ['awaiting_next_station', 'awaiting_triage'];
  for (const hop of remainingHops) {
    enc = await transitionEncounter(enc._id, hop, { actorId: input.actorId });
  }
  return enc;
}

/**
 * Stage 1-5 chain from a just-arrived encounter (post check-in) up to
 * `with_clinician` — the triage → routing → rooming hops a walk-in/appointment
 * arrival must pass through before a clinician can pick it up. Mirrors
 * FACILITY_DISCHARGE_CHAIN's pattern below: find where the encounter
 * currently sits and walk the remaining legal hops.
 */
const CLINICIAN_HANDOFF_CHAIN: EncounterStatus[] = [
  'arrived_at_facility',
  'awaiting_next_station',
  'awaiting_triage',
  'in_triage',
  'triaged_awaiting_destination',
  'routed_to_clinic',
  'arrived_at_clinic_awaiting_rooming',
  'in_rooming',
  'ready_for_clinician',
  'with_clinician',
];

/**
 * Statuses BEFORE a clinician has taken the visit — the only states a
 * front-desk (re-)check-in may join. Once the encounter is with a clinician
 * or in a downstream loop (labs, pharmacy, checkout), a second check-in must
 * not attach a fresh pending triage to the in-flight visit; the caller
 * rejects it instead.
 */
export const PRE_CLINICIAN_STATUSES: EncounterStatus[] = [
  'scheduled',
  'registered',
  ...CLINICIAN_HANDOFF_CHAIN.filter(status => status !== 'with_clinician'),
];

/**
 * Advance an already-arrived encounter (created via `createArrivalEncounter`
 * at check-in) through the legal triage/rooming chain to `with_clinician`,
 * picking up wherever it currently sits — instead of a consultation spawning
 * a second, disconnected encounter for the same visit
 * (docs/EMR-FIELD-AUDIT-2026-07.md §3, §5 "Consultation" call site). Every
 * hop runs through `transitionEncounter` so the machine is never bypassed and
 * the audit trail records the same moves check-in/triage/rooming stations
 * would have. Pre-arrival statuses (`scheduled`/`registered`) are hopped to
 * `arrived_at_facility` first. Already-`with_clinician` (or clinically
 * diverted — escalated/admitted/etc.) encounters are returned untouched
 * rather than throwing, since a resumed consult may legitimately find the
 * encounter already there.
 */
export async function advanceEncounterToClinician(
  id: string,
  opts: { clinicianId?: string; clinicianName?: string; snapshot?: Record<string, unknown>; triageId?: string; actorId?: string } = {},
): Promise<EncounterDoc> {
  let enc = await getEncounter(id);
  if (!enc) throw new Error(`Encounter not found: ${id}`);

  if (opts.clinicianId != null || opts.clinicianName != null || opts.snapshot != null || opts.triageId != null) {
    enc = await updateEncounter(id, {
      clinicianId: opts.clinicianId ?? enc.clinicianId,
      clinicianName: opts.clinicianName ?? enc.clinicianName,
      assignedClinicianId: opts.clinicianId ?? enc.assignedClinicianId,
      assignedClinicianName: opts.clinicianName ?? enc.assignedClinicianName,
      snapshot: opts.snapshot ?? enc.snapshot,
      triageId: opts.triageId ?? enc.triageId,
    }) ?? enc;
  }
  if (enc.status === 'with_clinician') return enc;

  if (enc.status === 'scheduled') {
    enc = await transitionEncounter(id, 'registered', { actorId: opts.actorId });
  }
  if (enc.status === 'registered') {
    enc = await transitionEncounter(id, 'arrived_at_facility', { actorId: opts.actorId });
  }

  const startIdx = CLINICIAN_HANDOFF_CHAIN.indexOf(enc.status);
  if (startIdx === -1) return enc; // not on this chain (e.g. escalated/admitted) — leave as-is

  for (let i = startIdx + 1; i < CLINICIAN_HANDOFF_CHAIN.length; i++) {
    enc = await transitionEncounter(id, CLINICIAN_HANDOFF_CHAIN[i], { actorId: opts.actorId });
  }
  return enc;
}

/**
 * Walk a checked-in encounter through triage and stop at the clinic door.
 *
 * Saving a triage used to write the triage document (and, since the visit
 * ladder gained its Triaged rung, the appointment status) and touch the
 * encounter not at all. The encounter therefore sat at `awaiting_triage`
 * forever: the rooming station — whose actions all require `routed_to_clinic`
 * or later — could never offer a room for a patient who had just been
 * assessed, while the ward board, reading the appointment, already said
 * "Triaged · Awaiting Rooming". Two machines, one patient, two answers.
 *
 * This closes that gap without overshooting it. `advanceEncounterToClinician`
 * exists but runs all the way to `with_clinician`, walking straight through
 * the rooming states without a human ever assigning a room — the very bypass
 * the rooming service's own header calls out. Triage hands the patient to the
 * clinic; rooming is a person's job, so the walk stops at `routed_to_clinic`
 * and the rooming station takes it from there.
 *
 * Every hop goes through `transitionEncounter`, so the audit trail records
 * `in_triage` → `triaged_awaiting_destination` → `routed_to_clinic` exactly as
 * a station-by-station walk would. An encounter already past this point (or
 * diverted — escalated, admitted, LWBS) is returned untouched.
 */
const TRIAGE_TO_CLINIC_CHAIN: EncounterStatus[] = [
  'awaiting_next_station',
  'awaiting_triage',
  'in_triage',
  'triaged_awaiting_destination',
  'routed_to_clinic',
];

export async function advanceEncounterAfterTriage(
  id: string,
  opts: { triageId?: string; destinationClinic?: string; actorId?: string } = {},
): Promise<EncounterDoc> {
  let enc = await getEncounter(id);
  if (!enc) throw new Error(`Encounter not found: ${id}`);

  // Link the triage to the visit thread even when the encounter is already
  // past this stretch — the record of which assessment fed this visit is
  // useful regardless of where the patient has since got to.
  if (opts.triageId != null || opts.destinationClinic != null) {
    enc = await updateEncounter(id, {
      triageId: opts.triageId ?? enc.triageId,
      destinationClinic: opts.destinationClinic ?? enc.destinationClinic,
    }) ?? enc;
  }

  const startIdx = TRIAGE_TO_CLINIC_CHAIN.indexOf(enc.status);
  // Not on this stretch: either already routed/roomed/with a clinician, or
  // diverted off the chain entirely. Either way there is nothing to walk.
  if (startIdx === -1) return enc;

  for (let i = startIdx + 1; i < TRIAGE_TO_CLINIC_CHAIN.length; i++) {
    enc = await transitionEncounter(id, TRIAGE_TO_CLINIC_CHAIN[i], { actorId: opts.actorId });
  }
  return enc;
}

export interface EnsureLabOrderEncounterInput {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  clinicianId?: string;
  clinicianName?: string;
  actorId?: string;
  placedAt?: string;
  /**
   * Where the order parks the visit. Imaging studies pause at
   * `awaiting_imaging` so the radiology queue and the visit state agree;
   * defaults to `awaiting_labs`.
   */
  to?: 'awaiting_labs' | 'awaiting_imaging';
}

/**
 * Anchor a lab/imaging order to the patient's CURRENT visit at this facility,
 * creating a minimal desk encounter only when no open visit exists.
 *
 * Placing an order used to open a brand-new `awaiting_labs` encounter
 * unconditionally, so ordering labs mid-consultation split the visit across
 * two encounter records: the consult stayed parked at `with_clinician` forever
 * while a parallel desk encounter carried the billing — and the duplicate
 * open encounter was itself a candidate for absorbing the patient's next
 * arrival. Reuse rules:
 *   - An open (non-terminal, <24h, same-facility) encounter is reused.
 *   - If it can legally move to `awaiting_labs` (e.g. `with_clinician`), it is
 *     walked there through the state machine so the pause is on the trail.
 *   - If it cannot (e.g. still `in_triage`), it is returned untouched — the
 *     order anchors to it via `encounterId` and runs as a parallel order
 *     lifecycle, exactly as the architecture document allows.
 *   - A different facility's open visit is never absorbed
 *     (`findOpenEncounterForPatient` already enforces this).
 */
export async function ensureLabOrderEncounter(input: EnsureLabOrderEncounterInput): Promise<EncounterDoc> {
  const to = input.to ?? 'awaiting_labs';
  const open = await findOpenEncounterForPatient(input.patientId, input.hospitalId);
  if (open) {
    if (open.status !== to && canTransition(open.status, to)) {
      return transitionEncounter(open._id, to, { actorId: input.actorId ?? input.clinicianId });
    }
    return open;
  }
  return createEncounter({
    patientId: input.patientId,
    patientName: input.patientName,
    hospitalNumber: input.hospitalNumber,
    clinicianId: input.clinicianId ?? '',
    clinicianName: input.clinicianName ?? '',
    createdBy: input.actorId ?? input.clinicianId,
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    orgId: input.orgId,
    // The patient is at the lab/imaging desk and nowhere else in the journey.
    status: to,
    snapshot: {},
    labOrderIds: [],
    startedAt: input.placedAt ?? new Date().toISOString(),
    arrivalChannel: 'walk_in',
  });
}

/**
 * Record ordered test ids on the visit. `labOrderIds` is what
 * `useResumableEncounters` counts to tell the clinician how many results are
 * back — an order that never lands here reads as "0 of 0 results" forever.
 */
export async function appendLabOrderIds(encounterId: string, orderIds: string[]): Promise<EncounterDoc | null> {
  const existing = await getEncounter(encounterId);
  if (!existing) return null;
  const merged = Array.from(new Set([...(existing.labOrderIds ?? []), ...orderIds]));
  return updateEncounter(encounterId, { labOrderIds: merged });
}

export interface CreateDirectConsultationEncounterInput {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  clinicianId: string;
  clinicianName: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  snapshot: Record<string, unknown>;
  labOrderIds?: string[];
  triageId?: string;
  startedAt: string;
  actorId?: string;
}

/**
 * Create an encounter for a consultation with no prior check-in (a clinician
 * starting a visit directly). Rather than materialising straight at
 * `with_clinician`, the encounter is created at the legal Stage 1 entry
 * status and walked hop-by-hop (via `transitionEncounter`, using the same
 * `CLINICIAN_HANDOFF_CHAIN` a checked-in arrival follows) so the state
 * machine is never bypassed, even for a direct consult.
 */
export async function createDirectConsultationEncounter(
  input: CreateDirectConsultationEncounterInput,
): Promise<EncounterDoc> {
  let enc = await createEncounter({
    patientId: input.patientId,
    patientName: input.patientName,
    hospitalNumber: input.hospitalNumber,
    clinicianId: input.clinicianId,
    clinicianName: input.clinicianName,
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    status: CLINICIAN_HANDOFF_CHAIN[0],
    snapshot: input.snapshot,
    labOrderIds: input.labOrderIds ?? [],
    triageId: input.triageId,
    startedAt: input.startedAt,
    orgId: input.orgId,
    arrivalChannel: 'walk_in',
  });
  for (let i = 1; i < CLINICIAN_HANDOFF_CHAIN.length; i++) {
    enc = await transitionEncounter(enc._id, CLINICIAN_HANDOFF_CHAIN[i], { actorId: input.actorId });
  }
  return enc;
}

/**
 * Facility checkout (Stage 10): advance an encounter that has finished its
 * clinical work through the legal clinic-checkout → facility-checkout chain to
 * a terminal `discharged` status (or `discharged_with_pending_items` when the
 * checkout gate had unmet items that were overridden). Encounters that are
 * already terminal, or that haven't reached the clinic-checkout stage yet (e.g.
 * still `with_clinician`, or admitted/deceased/referred), are left untouched —
 * we never force a discharge on a visit the clinician hasn't closed.
 */
const FACILITY_DISCHARGE_CHAIN: EncounterStatus[] = [
  'ready_for_clinic_checkout',
  'in_clinic_checkout',
  'clinic_complete_awaiting_next_station',
  'awaiting_facility_checkout',
  'in_facility_checkout',
];

/** The four documented discharge dispositions (Stage 10 terminal statuses). */
export type DischargeDisposition =
  | 'discharged'
  | 'discharged_with_referral'
  | 'discharged_with_pending_items'
  | 'dismissed_without_formal_checkout';

export async function dischargeEncounter(
  id: string,
  opts: { actorId?: string; pendingItems?: boolean; disposition?: DischargeDisposition } = {},
): Promise<EncounterDoc | null> {
  const enc = await getEncounter(id);
  if (!enc) return null;
  if (isTerminal(enc.status)) return enc; // already closed — nothing to do
  const startIdx = FACILITY_DISCHARGE_CHAIN.indexOf(enc.status);
  if (startIdx === -1) return enc; // not in a checkout-eligible state — leave as-is

  // Explicit disposition wins; the legacy pendingItems flag maps onto its
  // disposition so existing callers keep their behavior. Before dispositions
  // existed, "discharged with referral" and "walked out mid-checkout" were
  // unrepresentable — every discharge reported as routine.
  let finalStatus: EncounterStatus = opts.disposition
    ?? (opts.pendingItems ? 'discharged_with_pending_items' : 'discharged');

  // A dismissal is only legal FROM `awaiting_facility_checkout`. An encounter
  // already IN facility checkout has passed that door — the machine offers no
  // dismissal edge there, and attempting one used to throw, get swallowed by
  // the desk's best-effort wrapper, and let the appointment bridge re-close
  // the visit as a routine `discharged` — the opposite of what the clerk
  // documented. Walking out mid-facility-checkout maps to the closest honest
  // terminal: discharged with pending items.
  if (finalStatus === 'dismissed_without_formal_checkout' && enc.status === 'in_facility_checkout') {
    finalStatus = 'discharged_with_pending_items';
  }

  // A dismissal is legal only FROM `awaiting_facility_checkout` — the patient
  // left before facility checkout began — so that walk stops one hop short.
  const chainEnd = finalStatus === 'dismissed_without_formal_checkout'
    ? FACILITY_DISCHARGE_CHAIN.indexOf('awaiting_facility_checkout') + 1
    : FACILITY_DISCHARGE_CHAIN.length;

  let current = enc;
  // Step through the remaining chain hops, then the terminal discharge.
  for (let i = startIdx + 1; i < chainEnd; i++) {
    current = await transitionEncounter(id, FACILITY_DISCHARGE_CHAIN[i], { actorId: opts.actorId });
  }
  current = await transitionEncounter(id, finalStatus, { actorId: opts.actorId });

  // Close the booking with the visit — the other half of the bridge
  // appointment-service runs in the opposite direction. Without it a
  // discharged visit could leave its appointment open on the board, and the
  // two records told different truths. Best-effort; dynamic import because
  // appointment-service imports this module. The opposite bridge cannot
  // recurse: it calls back into dischargeEncounter, which returns at the
  // isTerminal guard above.
  if (current.appointmentId) {
    try {
      const { getAppointmentById, updateAppointmentStatus } = await import('./appointment-service');
      const { APPOINTMENT_CLOSED_STATUSES } = await import('../appointment-status');
      const appt = await getAppointmentById(current.appointmentId);
      if (appt && !APPOINTMENT_CLOSED_STATUSES.includes(appt.status)) {
        await updateAppointmentStatus(appt._id, 'completed', { actorId: opts.actorId });
      }
    } catch {
      // The visit is closed either way; the desk can complete the booking.
    }
  }

  // Clear the shared progress tracker (KAN-?? — "write-only progress
  // tracker"). Nothing ever moved a ConsultationProgressDoc to 'completed', so
  // the last real update (often "waiting for provider") stood forever and the
  // notification bell kept reporting a patient as in-progress long after the
  // facility discharged them. Best-effort and scoped to THIS visit's own
  // tracker, looked up by `{patientId, encounterId}` — a stale tracker from an
  // unrelated earlier episode (a prior, already-closed visit for the same
  // patient) must never be closed by this discharge, so there is no
  // most-recently-touched fallback: no tracker for this encounter means
  // nothing to close.
  try {
    const { getConsultationProgressByEncounter, updateProgressMilestone } = await import('./consultation-progress-service');
    const tracker = await getConsultationProgressByEncounter(current.patientId, id);
    if (tracker && tracker.currentStage !== 'completed' && tracker.currentStage !== 'cancelled') {
      await updateProgressMilestone(tracker._id, 'consultation_signed', 'completed', { id: opts.actorId });
    }
  } catch {
    // A stale progress notification is a nuisance, not a safety issue.
  }

  // Patient-level assignment fields are a compatibility cache for the active
  // visit. The encounter retains the historical care team, so leaving those
  // fields on the patient after discharge only makes a closed visit appear as
  // live work on the doctor/nurse dashboards. Clear them only when there is no
  // newer open encounter for this patient; a concurrent re-arrival owns the
  // cache and must not be erased by the older visit finishing.
  try {
    const newerOpen = await findOpenEncounterForPatient(current.patientId, current.hospitalId);
    if (!newerOpen || newerOpen._id === current._id) {
      const { getPatientById, updatePatient } = await import('./patient-service');
      const patient = await getPatientById(current.patientId);
      const clinicianId = current.assignedClinicianId || current.clinicianId;
      const ownsProvider = Boolean(clinicianId && patient?.assignedDoctor === clinicianId);
      const ownsNurse = Boolean(current.assignedNurseId && patient?.assignedNurse === current.assignedNurseId);
      if (patient && (ownsProvider || ownsNurse)) {
        await updatePatient(patient._id, {
          ...(ownsProvider ? {
            assignedDoctor: undefined,
            assignedDoctorName: undefined,
            assignedAt: undefined,
            assignedBy: undefined,
            assignedByName: undefined,
            assignmentNote: undefined,
            assignmentAcceptedAt: undefined,
            assignmentAcceptedBy: undefined,
            assignmentAcceptedByName: undefined,
          } : {}),
          ...(ownsNurse ? {
            assignedNurse: undefined,
            assignedNurseName: undefined,
            assignedNurseAt: undefined,
            assignedNurseBy: undefined,
            assignedNurseByName: undefined,
          } : {}),
          assignmentStatus: 'completed',
        });
      }
    }
  } catch {
    // The encounter is already safely closed. A repair can clear a stale
    // compatibility cache without reopening or changing the clinical record.
  }

  return current;
}


/**
 * Record that a patient left before being seen (KAN-100).
 *
 * `lwbs` and `escalated_to_emergency` are legal transitions out of every
 * pre-clinician triage state, but **nothing in the UI could reach either of
 * them**. So a patient who walked out of the waiting room stayed "waiting"
 * indefinitely: they sat in the triage queue forever, inflated the waiting
 * count every dashboard reports, and — because `findOpenEncounterForPatient`
 * reuses a non-terminal encounter within 24h — their abandoned visit could
 * absorb a genuine re-attendance later the same day, writing the second
 * visit's triage and consultation onto the first visit's record.
 *
 * Recording LWBS is also a real clinical-governance signal in its own right:
 * the rate at which patients leave untreated is a facility quality measure, and
 * it cannot be measured if the event has no representation.
 */
/**
 * Send an open visit back to reception without closing it: the patient
 * stepped out and may return, the handoff named the wrong provider, or the
 * visit needs rebooking. Moves the encounter to `awaiting_next_station` — the
 * desk-owned crossroads whose onward edges (re-route, escalate, close as
 * LWBS) are exactly the choices reception then has. The appointment
 * projection keeps the visit In Facility, so the front-desk board shows the
 * patient as theirs again; the returned-to-desk notification derivation
 * (visit-updates.ts) tells reception it happened.
 */
export async function returnEncounterToFrontDesk(
  encounterId: string,
  opts?: { actorId?: string; actorRole?: UserRole; reason?: string },
): Promise<EncounterDoc> {
  const updated = await transitionEncounter(encounterId, 'awaiting_next_station', {
    actorId: opts?.actorId, actorRole: opts?.actorRole, reason: opts?.reason,
  });
  await logAuditSafe(
    'ENCOUNTER_RETURNED_TO_DESK',
    opts?.actorId,
    undefined,
    `Visit for ${updated.patientName || updated.patientId} returned to the front desk` +
    (opts?.reason ? ` — ${opts.reason}` : ''),
  );
  return updated;
}

export async function recordLeftWithoutBeingSeen(
  encounterId: string,
  opts?: { actorId?: string; reason?: string },
): Promise<EncounterDoc> {
  const updated = await transitionEncounter(encounterId, 'lwbs', {
    actorId: opts?.actorId, reason: opts?.reason,
  });
  await logAuditSafe(
    'ENCOUNTER_LWBS',
    opts?.actorId,
    undefined,
    `Patient ${updated.patientName || updated.patientId} left without being seen` +
    (opts?.reason ? ` — ${opts.reason}` : ''),
  );
  return updated;
}

/**
 * Escalate a patient who is being assessed, or already past triage, straight to
 * emergency care (KAN-100).
 *
 * NOT callable on a patient who is only queueing (`awaiting_triage`): that move
 * is deliberately absent from the state machine, because escalating someone
 * nobody has looked at asserts an emergency on no assessment. Take them into
 * triage first — one hop — and escalate from there. This call throws rather
 * than silently walking that hop itself, so the record shows a real assessment
 * rather than one the system invented.
 *
 * Unlike LWBS this is NOT terminal — `escalated_to_emergency` still leads on to
 * admitted / discharged / deceased / referred_out, so the visit continues under
 * emergency care rather than being closed here.
 */
export async function escalateEncounterToEmergency(
  encounterId: string,
  opts?: { actorId?: string; reason?: string },
): Promise<EncounterDoc> {
  const updated = await transitionEncounter(encounterId, 'escalated_to_emergency', {
    actorId: opts?.actorId, reason: opts?.reason,
  });
  await logAuditSafe(
    'ENCOUNTER_ESCALATED_TO_EMERGENCY',
    opts?.actorId,
    undefined,
    `Patient ${updated.patientName || updated.patientId} escalated to emergency` +
    (opts?.reason ? ` — ${opts.reason}` : ''),
  );
  return updated;
}
