import { telehealthDB } from '../db';
import type { AppointmentStatus, TelehealthSessionDoc, TelehealthStatus, TelehealthType, TelehealthTerminationReason } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { jubaDate } from '../time-juba';
import { roomNameForSession, buildPatientJoinUrl, buildProviderJoinUrl } from '../telehealth-room';

/**
 * Thrown when a session is moved to `in_session` without valid consent.
 *
 * A distinct class so the caller can tell "you may not admit this patient yet"
 * apart from a write failure, and say so — the UI must explain the refusal
 * rather than showing a generic error, or the clinician will simply retry.
 */
export class ConsentRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsentRequiredError';
  }
}

/**
 * `encounterId` links a telehealth session to the clinical visit encounter it
 * belongs to (see `ensureTelehealthEncounter`). It is not yet part of
 * `TelehealthSessionDoc` in db-types.ts — declared locally here rather than
 * widening that shared type from this change alone. Every write goes through
 * `updateSession`, which spreads onto the existing document rather than
 * replacing it, so the field round-trips through PouchDB/CouchDB fine even
 * though the shared type doesn't know about it yet.
 */
export type TelehealthSessionWithEncounter = TelehealthSessionDoc & { encounterId?: string };

export async function getAllSessions(scope?: DataScope): Promise<TelehealthSessionDoc[]> {
  const db = telehealthDB();
  const all = (await findByType<TelehealthSessionDoc>(db, 'telehealth_session'))
    .sort((a, b) => {
      const dateA = `${a.scheduledDate}T${a.scheduledTime}`;
      const dateB = `${b.scheduledDate}T${b.scheduledTime}`;
      return dateB.localeCompare(dateA); // Most recent first
    });
  return scope ? filterByScope(all, scope) : all;
}

/**
 * Fetch one session by id.
 *
 * Returns null rather than throwing on a missing document — callers are
 * authorisation checks and UI loaders, both of which want "not found" as a
 * value they can branch on.
 *
 * Deliberately NOT scope-filtered: the token route needs the raw record to
 * decide whether the caller is the assigned provider or the patient, and it
 * performs that check itself. Callers that list sessions must keep using the
 * scoped helpers below.
 */
export async function getSessionById(id: string): Promise<TelehealthSessionDoc | null> {
  const db = telehealthDB();
  try {
    return await db.get(id) as TelehealthSessionDoc;
  } catch {
    return null;
  }
}

export async function getSessionsByPatient(patientId: string): Promise<TelehealthSessionDoc[]> {
  const all = await getAllSessions();
  return all.filter(s => s.patientId === patientId);
}

export async function getSessionsByProvider(providerId: string): Promise<TelehealthSessionDoc[]> {
  const all = await getAllSessions();
  return all.filter(s => s.providerId === providerId);
}

export async function getUpcomingSessions(scope?: DataScope): Promise<TelehealthSessionDoc[]> {
  const today = jubaDate();
  const all = await getAllSessions(scope);
  return all
    .filter(s =>
      s.scheduledDate >= today &&
      s.status !== 'cancelled' &&
      s.status !== 'completed' &&
      s.status !== 'failed'
    )
    .sort((a, b) => {
      const dateA = `${a.scheduledDate}T${a.scheduledTime}`;
      const dateB = `${b.scheduledDate}T${b.scheduledTime}`;
      return dateA.localeCompare(dateB);
    });
}

export async function getTodaysSessions(scope?: DataScope): Promise<TelehealthSessionDoc[]> {
  const today = jubaDate();
  const all = await getAllSessions(scope);
  return all.filter(s => s.scheduledDate === today);
}

/**
 * The document id for an appointment-backed session.
 *
 * Deterministic on purpose (KAN-126). There are no unique secondary indexes in
 * CouchDB/PouchDB, so the `_id` is the ONLY place a uniqueness constraint can
 * live: deriving it from the appointment makes a duplicate create fail as a
 * 409 conflict instead of silently minting a second session with a second
 * room. That is what let two clinicians opening the same visit — or one
 * clinician refreshing the page — land in different rooms.
 */
export function sessionIdForAppointment(appointmentId: string): string {
  return `tele-appt-${appointmentId}`;
}

/**
 * The session for an appointment, or null.
 *
 * A direct `get` on the deterministic id — no scan — so this stays cheap
 * enough to call on the create path.
 */
export async function getSessionByAppointmentId(
  appointmentId: string,
): Promise<TelehealthSessionDoc | null> {
  return getSessionById(sessionIdForAppointment(appointmentId));
}

/** Session statuses past which a session should not be reused. */
const TERMINAL_SESSION_STATUSES: readonly TelehealthStatus[] = [
  'completed', 'cancelled', 'failed', 'no_show',
];

export async function createSession(
  data: Omit<TelehealthSessionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'roomId'>
): Promise<TelehealthSessionDoc> {
  const db = telehealthDB();
  const now = new Date().toISOString();

  // Appointment-backed sessions are keyed by the appointment so that repeat
  // calls converge on one document. Walk-in sessions carry no appointment and
  // are deliberately EXEMPT from the uniqueness rule — each walk-in genuinely
  // is a new encounter, so a random id is correct for them.
  if (data.appointmentId) {
    const existing = await getSessionByAppointmentId(data.appointmentId);
    if (existing) {
      // Live session: converge on it. This is the case that fixes the split
      // room — a refresh or a second clinician joins the SAME session.
      if (!TERMINAL_SESSION_STATUSES.includes(existing.status)) return existing;

      // Terminal session: this appointment's visit is over. Neither available
      // option is silent — returning it would drop a clinician into a closed
      // room, and writing over it would destroy the completed record at the
      // same deterministic id. Refuse, and make the caller book a new
      // appointment for a follow-up visit.
      throw new Error(
        `Appointment ${data.appointmentId} already has a ${existing.status} telehealth session ` +
        `(${existing._id}); a follow-up visit needs its own appointment`,
      );
    }
  }

  const id = data.appointmentId
    ? sessionIdForAppointment(data.appointmentId)
    : `tele-${uuidv4().slice(0, 8)}`;

  // The LiveKit room name is DERIVED from the session id, not stored as an
  // independent value, so the two can never drift apart. `roomId` is kept for
  // backward compatibility with existing records and the analytics projection.
  const roomId = roomNameForSession(id);

  const doc: TelehealthSessionDoc = {
    _id: id,
    type: 'telehealth_session',
    roomId,
    // Join links carry the session id ONLY — never a token. A link that leaks
    // (forwarded SMS, screenshot) therefore grants nothing on its own; the
    // holder still has to authenticate and be a participant to mint media
    // credentials at /api/telehealth/token.
    joinUrl: buildPatientJoinUrl(id),
    // Built from the APPOINTMENT id — that is what the clinician route resolves.
    // Absent for walk-ins, which have no appointment.
    providerJoinUrl: buildProviderJoinUrl(data.appointmentId) ?? undefined,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  let resp;
  try {
    resp = await db.put(doc);
  } catch (err) {
    // 409 means another caller won the race between the read above and this
    // write. Re-read and return THEIR document rather than retrying with a new
    // id — the point of the deterministic id is that both callers converge.
    const conflict = (err as { status?: number; name?: string } | null);
    if (data.appointmentId && (conflict?.status === 409 || conflict?.name === 'conflict')) {
      const winner = await getSessionByAppointmentId(data.appointmentId);
      // Same terminality rule as above — a race that lands on a finished
      // session must not hand back a closed room just because it arrived via
      // the conflict path instead of the read path.
      if (winner && !TERMINAL_SESSION_STATUSES.includes(winner.status)) return winner;
    }
    throw err;
  }
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_TELEHEALTH', data.providerId, data.providerName,
    `Telehealth session ${doc._id}: ${data.patientName} with ${data.providerName} on ${data.scheduledDate} at ${data.scheduledTime}`
  );
  emitSyncEvent({
    resourceType: 'telehealth_session',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updateSessionStatus(
  id: string,
  status: TelehealthStatus,
  extra?: Partial<TelehealthSessionDoc>
): Promise<TelehealthSessionDoc | null> {
  const db = telehealthDB();

  // ── Consent gate ────────────────────────────────────────────────────────
  // Admission is refused without valid consent. This is the binding check:
  // the provider room also disables its Admit button, but that is client code
  // and the room is not the only caller of this function.
  //
  // Deliberately outside the try/catch below. That catch returns null on any
  // failure, and a consent refusal swallowed into a null would be reported to
  // the clinician as "something went wrong" — they would retry, and the real
  // reason would never surface.
  if (status === 'in_session') {
    const current = await db.get(id).catch(() => null) as TelehealthSessionDoc | null;
    // An unreadable session falls through to the normal path, which fails
    // closed on its own; only a session we can read and that lacks consent is
    // refused here, so this cannot mask a storage problem as a consent problem.
    if (current && !current.patientConsentGiven && extra?.patientConsentGiven !== true) {
      throw new ConsentRequiredError(
        current.consentWithdrawnAt
          ? 'The patient withdrew consent for this visit. They must consent again before it can start.'
          : 'This visit cannot start until the patient has consented to a telehealth consultation.',
      );
    }
  }

  try {
    const existing = await db.get(id) as TelehealthSessionDoc;
    const now = new Date().toISOString();
    const updated: TelehealthSessionDoc = {
      ...existing,
      status,
      updatedAt: now,
      // First admission stamps the start; re-entering an in-session visit
      // after a reconnect must not restart the clock.
      ...(status === 'in_session' && !existing.actualStartTime ? { actualStartTime: now } : {}),
      ...(TERMINAL_SESSION_STATUSES.includes(status) ? { actualEndTime: now } : {}),
      ...(extra || {}),
    };

    // Every terminal state gets a reason, so an abandoned or dropped visit can
    // be told apart from a clean one afterwards (KAN-127). An explicit reason
    // passed by the caller always wins; these are the defaults implied by the
    // status itself.
    if (TERMINAL_SESSION_STATUSES.includes(status) && !updated.terminationReason) {
      const implied: Partial<Record<TelehealthStatus, TelehealthTerminationReason>> = {
        completed: 'provider_ended',
        cancelled: 'cancelled',
        no_show: 'no_show',
        failed: 'connection_failed',
      };
      updated.terminationReason = implied[status];
    }

    // Duration is DERIVED from the stored timestamps, never read from a
    // client's elapsed timer, and is computed for every terminal state rather
    // than only for `completed` — otherwise an abandoned visit reports no
    // duration at all and silently averages in as zero.
    if (TERMINAL_SESSION_STATUSES.includes(status) && updated.actualStartTime && updated.actualEndTime) {
      const start = new Date(updated.actualStartTime).getTime();
      const end = new Date(updated.actualEndTime).getTime();
      // Clock skew between writers can invert these; a negative duration is
      // worse than an absent one.
      updated.duration = end >= start ? Math.round((end - start) / 60000) : undefined;
    }

    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_TELEHEALTH', undefined, undefined, `Telehealth session ${id} status changed to ${status}`);
    emitSyncEvent({
      resourceType: 'telehealth_session',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });

    // Keep the originating appointment in step. Without this a telehealth
    // visit could run to completion while its appointment still read
    // "scheduled" — the front desk would show the patient as never seen, and
    // the appointment would eventually age into a false no-show.
    await syncAppointmentToSessionStatus(updated, status);

    return updated;
  } catch {
    return null;
  }
}

/**
 * Mirror a telehealth session's lifecycle onto its linked appointment.
 *
 * Only the transitions that have an unambiguous appointment meaning are
 * mapped. `waiting_room` deliberately maps to `checked_in`: the patient has
 * presented for their appointment but the clinician has not started, which is
 * exactly what checked-in means at a physical front desk.
 *
 * Best-effort and non-fatal — the session record is the source of truth for
 * the visit itself, and failing to update the appointment must not roll back a
 * completed consultation.
 */
async function syncAppointmentToSessionStatus(
  session: TelehealthSessionDoc,
  status: TelehealthStatus,
): Promise<void> {
  if (!session.appointmentId) return;

  const mapped: Partial<Record<TelehealthStatus, AppointmentStatus>> = {
    waiting_room: 'checked_in',
    in_session: 'in_progress',
    completed: 'completed',
    cancelled: 'cancelled',
    no_show: 'no_show',
  };
  const next = mapped[status];
  if (!next) return;

  try {
    const { updateAppointmentStatus, getAppointmentById } = await import('./appointment-service');

    // A cancelled appointment is a decision someone made; a late session event
    // must not silently reopen it. Without this guard a stale "completed" from
    // an abandoned room would resurrect a cancelled visit as attended, which
    // then bills and reports as real activity (KAN-127).
    const appointment = await getAppointmentById(session.appointmentId);
    if (appointment?.status === 'cancelled' && next !== 'cancelled') {
      console.warn(
        `[telehealth] refusing to move cancelled appointment ${session.appointmentId} to ${next}` +
        ` (session ${session._id} reported ${status})`,
      );
      return;
    }

    await updateAppointmentStatus(session.appointmentId, next);
  } catch (err) {
    // Still non-fatal — rolling back a completed consultation because an
    // appointment write failed would be the worse outcome. But silence was the
    // actual defect: this now leaves an audit record, so a session and
    // appointment that drift apart are discoverable instead of invisible
    // (KAN-127). Full reconciliation is KAN-143.
    console.warn(
      `[telehealth] could not sync appointment ${session.appointmentId} to ${next}`,
      err,
    );
    await logAuditSafe(
      'TELEHEALTH_APPOINTMENT_SYNC_FAILED',
      session.providerId,
      session.providerName,
      `Session ${session._id} reached ${status} but appointment ${session.appointmentId} ` +
      `could not be moved to ${next}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function updateSession(
  id: string,
  updates: Partial<TelehealthSessionDoc>
): Promise<TelehealthSessionDoc | null> {
  const db = telehealthDB();
  try {
    const existing = await db.get(id) as TelehealthSessionDoc;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_TELEHEALTH', undefined, undefined, `Telehealth session ${id} updated`);
    emitSyncEvent({
      resourceType: 'telehealth_session',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    return updated;
  } catch {
    return null;
  }
}

/**
 * Record that consent to the telehealth encounter was obtained, and on what basis.
 *
 * Consent is deliberately NOT a plain boolean setter. `patientConsentGiven`
 * alone says a patient agreed but not who recorded it or how, which is not a
 * defensible record — and the provider room previously set it to `true`
 * automatically at session creation, fabricating an affirmative consent
 * record, complete with timestamp, for a patient nobody had asked.
 *
 * Every consent write therefore carries its provenance:
 *   - `patient_portal`           the patient themselves affirmed it
 *   - `provider_attested_verbal` a named clinician is attesting they asked
 *   - `written`                  a signed form exists on file
 *
 * The audit line names the attesting user, because the point of an attestation
 * is that it is attributable to a person.
 */
export async function recordConsent(
  id: string,
  consent: {
    method: NonNullable<TelehealthSessionDoc['consentMethod']>;
    attestedBy?: string;
    attestedByName?: string;
    /** Patient portal user id, when the patient consents themselves. */
    consentedBy?: string;
    /** The policy version the patient was actually shown. */
    policyVersion?: string;
  },
): Promise<TelehealthSessionDoc | null> {
  if (consent.method === 'provider_attested_verbal' && !consent.attestedBy) {
    // Refuse rather than silently store an unattributable attestation — an
    // attestation with no attester is exactly the record we are removing.
    throw new Error('provider_attested_verbal consent requires attestedBy (the clinician\'s user id)');
  }
  if (consent.method === 'patient_portal' && !consent.consentedBy) {
    // Same rule from the other side. "The patient consented" with no patient
    // id is not a first-party record, it is an unsourced claim that happens to
    // be labelled first-party — which is worse than an honest attestation.
    throw new Error('patient_portal consent requires consentedBy (the patient\'s portal user id)');
  }

  const updated = await updateSession(id, {
    patientConsentGiven: true,
    consentTimestamp: new Date().toISOString(),
    consentMethod: consent.method,
    consentAttestedBy: consent.attestedBy,
    consentAttestedByName: consent.attestedByName,
    consentedBy: consent.consentedBy,
    consentPolicyVersion: consent.policyVersion,
    // Re-consent after a withdrawal clears the withdrawal marks, so the
    // current state is unambiguous. The audit log keeps the history.
    consentWithdrawnAt: undefined,
    consentWithdrawnReason: undefined,
  });

  if (updated) {
    await logAuditSafe(
      'TELEHEALTH_CONSENT_RECORDED',
      consent.attestedBy || consent.consentedBy,
      consent.attestedByName,
      `Telehealth consent recorded for session ${id} — method: ${consent.method}` +
      (consent.policyVersion ? `, policy ${consent.policyVersion}` : '') +
      (consent.attestedByName ? `, attested by ${consent.attestedByName}` : ''),
    );
  }
  return updated;
}

/**
 * The patient arrives and enters the waiting room (KAN-128).
 *
 * This is the ONLY thing that should put a session into `waiting_room`, so
 * that state means "a real patient is waiting" and nothing else. The provider
 * room previously showed a waiting patient on a timer; the whole point of
 * routing it through here is that the clinician's screen can no longer tell
 * that story when nobody has arrived.
 *
 * Idempotent on `waitingSince`: a patient who reloads, or whose connection
 * drops and recovers, keeps their ORIGINAL arrival time. Restamping it would
 * reset the queue position of whoever has been waiting longest — the one
 * patient for whom an accurate wait matters most.
 */
export async function enterWaitingRoom(
  id: string,
  opts: { patientId: string },
): Promise<TelehealthSessionDoc | null> {
  const existing = await getSessionById(id);
  if (!existing) return null;

  // Already in the visit — re-entering the waiting room would pull an
  // in-progress consultation backwards into the queue.
  if (existing.status === 'in_session') return existing;

  const updated = await updateSessionStatus(id, 'waiting_room', {
    waitingSince: existing.waitingSince || new Date().toISOString(),
  });

  if (updated && !existing.waitingSince) {
    await logAuditSafe(
      'TELEHEALTH_WAITING_ROOM_ENTERED',
      opts.patientId,
      undefined,
      `Patient entered the waiting room for session ${id}`,
    );
  }
  return updated;
}

/**
 * Best-effort: make sure the telehealth session's visit encounter exists and
 * is linked to it.
 *
 * Without this a telehealth visit produced no encounter at all — it never
 * showed up on the clinician's worklists, could not carry a signed note or a
 * charge, and left `getTelehealthStats().followUpRate` reading a field
 * nothing ever set. Reuses the patient's already-open encounter at this
 * facility when one exists (created earlier the same day by a check-in,
 * another consult, or a prior admit on THIS session) rather than always
 * minting a new one, matching the pattern `ensureLabOrderEncounter` already
 * uses for the same reason. Only advances a reused encounter toward
 * `with_clinician` when it is still in a pre-clinician state — one already
 * `with_clinician` or further along (labs, checkout, …) is linked as-is,
 * never pulled backwards or forwards past where a human already moved it.
 *
 * Idempotent: a session that already carries an `encounterId` is returned
 * unchanged, so re-admitting the same session (a reconnect) never spawns a
 * second encounter for the same visit.
 *
 * Non-fatal by design — every failure here is caught and logged rather than
 * thrown, because the visit itself must run whether or not this bookkeeping
 * succeeds.
 */
export async function ensureTelehealthEncounter(
  session: TelehealthSessionDoc,
): Promise<TelehealthSessionDoc | null> {
  if ((session as TelehealthSessionWithEncounter).encounterId) return session;

  try {
    const {
      findOpenEncounterForPatient, createEncounter, advanceEncounterToClinician, PRE_CLINICIAN_STATUSES,
    } = await import('./encounter-service');

    let encounterId: string;
    const open = await findOpenEncounterForPatient(session.patientId, session.facilityId);
    if (open) {
      encounterId = open._id;
      if (PRE_CLINICIAN_STATUSES.includes(open.status)) {
        await advanceEncounterToClinician(open._id, {
          clinicianId: session.providerId,
          clinicianName: session.providerName,
          actorId: session.providerId,
        });
      }
      // Already with_clinician or further along (labs, checkout, …) — leave
      // it exactly where it is and just link the session to it.
    } else {
      const created = await createEncounter({
        patientId: session.patientId,
        patientName: session.patientName,
        clinicianId: session.providerId,
        clinicianName: session.providerName,
        hospitalId: session.facilityId,
        hospitalName: session.facilityName,
        orgId: session.orgId,
        status: 'with_clinician',
        arrivalChannel: 'telehealth',
        snapshot: {},
        labOrderIds: [],
        startedAt: new Date().toISOString(),
      });
      encounterId = created._id;
    }

    return await updateSession(session._id, { encounterId } as unknown as Partial<TelehealthSessionDoc>);
  } catch (err) {
    console.warn(`[telehealth] could not link a visit encounter for session ${session._id}`, err);
    return session;
  }
}

/**
 * The clinician admits the waiting patient.
 *
 * Goes through `updateSessionStatus`, so the KAN-125 consent gate applies and
 * throws `ConsentRequiredError` when there is no valid consent — admission is
 * the exact moment that check exists for.
 */
export async function admitFromWaitingRoom(
  id: string,
  opts: { admittedBy: string; admittedByName?: string },
): Promise<TelehealthSessionDoc | null> {
  const updated = await updateSessionStatus(id, 'in_session', {
    admittedAt: new Date().toISOString(),
    admittedBy: opts.admittedBy,
    admittedByName: opts.admittedByName,
    // A re-admission after a dropped connection must not clear the record of
    // an earlier rejection; only a fresh rejection writes these.
  });

  if (updated) {
    await logAuditSafe(
      'TELEHEALTH_PATIENT_ADMITTED',
      opts.admittedBy,
      opts.admittedByName,
      `Patient admitted to telehealth session ${id}`,
    );
    // Best-effort — a failure to link the encounter must not undo an
    // admission that already succeeded.
    return (await ensureTelehealthEncounter(updated)) || updated;
  }
  return updated;
}

/**
 * The clinician turns the waiting patient away.
 *
 * Recorded as `cancelled` rather than `no_show`: the patient did arrive, and
 * a no-show on their record would be false — it is the kind of error that
 * follows someone through a health system and is never corrected.
 *
 * The reason is required, because a rejection the patient cannot understand
 * leaves them staring at a closed door with no next step.
 */
export async function rejectFromWaitingRoom(
  id: string,
  opts: { rejectedBy: string; rejectedByName?: string; reason: string },
): Promise<TelehealthSessionDoc | null> {
  const reason = opts.reason?.trim();
  if (!reason) {
    throw new Error('A rejection reason is required — the patient is shown it.');
  }

  const updated = await updateSessionStatus(id, 'cancelled', {
    terminationReason: 'cancelled',
    rejectedAt: new Date().toISOString(),
    rejectedBy: opts.rejectedBy,
    rejectedByName: opts.rejectedByName,
    rejectionReason: reason,
  });

  if (updated) {
    await logAuditSafe(
      'TELEHEALTH_PATIENT_REJECTED',
      opts.rejectedBy,
      opts.rejectedByName,
      `Patient turned away from telehealth session ${id} — reason: ${reason}`,
    );
  }
  return updated;
}

/**
 * The patient withdraws consent before the visit starts.
 *
 * Recorded rather than erased: clearing `patientConsentGiven` on its own would
 * make a withdrawn consent look identical to one never given, losing the fact
 * that the patient made a decision and when they made it. The withdrawal marks
 * survive alongside the cleared flag, and admission is blocked until consent is
 * given again.
 */
export async function withdrawConsent(
  id: string,
  opts: { withdrawnBy: string; reason?: string },
): Promise<TelehealthSessionDoc | null> {
  const updated = await updateSession(id, {
    patientConsentGiven: false,
    consentWithdrawnAt: new Date().toISOString(),
    consentWithdrawnReason: opts.reason,
  });

  if (updated) {
    await logAuditSafe(
      'TELEHEALTH_CONSENT_WITHDRAWN',
      opts.withdrawnBy,
      undefined,
      `Telehealth consent withdrawn for session ${id}` +
      (opts.reason ? ` — reason: ${opts.reason}` : ''),
    );
  }
  return updated;
}


export async function addClinicalNotes(
  id: string,
  notes: string,
  diagnosis?: string,
  icd10Code?: string
): Promise<TelehealthSessionDoc | null> {
  return updateSession(id, { clinicalNotes: notes, diagnosis, icd10Code });
}

/** Raised when a participant tries to rate a session they have already rated. */
export class AlreadyRatedError extends Error {
  constructor(sessionId: string, who: 'patient' | 'provider') {
    super(`Session ${sessionId} already has a ${who} rating`);
    this.name = 'AlreadyRatedError';
  }
}

function assertRatingInRange(rating: number): void {
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error(`Rating must be between 1 and 5, got ${rating}`);
  }
}

/**
 * Record the patient's satisfaction rating for a completed visit.
 *
 * Duplicate submission is refused HERE rather than by hiding the button
 * (KAN-132 item 3): the form is on a patient-facing screen, so the only place
 * the one-rating-per-participant rule can actually hold is the write path.
 */
export async function rateSession(
  id: string,
  rating: number,
  feedback?: string
): Promise<TelehealthSessionDoc | null> {
  assertRatingInRange(rating);
  const existing = await getSessionById(id);
  if (!existing) return null;
  if (existing.patientRating !== undefined) throw new AlreadyRatedError(id, 'patient');

  return updateSession(id, {
    patientRating: rating,
    patientFeedback: feedback,
    patientRatedAt: new Date().toISOString(),
  });
}

/**
 * Record the provider's rating of TECHNICAL quality — was the connection
 * usable? A separate question from the patient's satisfaction, and stored in a
 * separate field so the two can never be averaged together.
 */
export async function rateSessionTechnical(
  id: string,
  rating: number,
  feedback?: string
): Promise<TelehealthSessionDoc | null> {
  assertRatingInRange(rating);
  const existing = await getSessionById(id);
  if (!existing) return null;
  if (existing.providerTechnicalRating !== undefined) throw new AlreadyRatedError(id, 'provider');

  return updateSession(id, {
    providerTechnicalRating: rating,
    providerFeedback: feedback,
    providerRatedAt: new Date().toISOString(),
  });
}

/**
 * The smallest group size for which an average rating may be reported.
 *
 * Below this, an "average" is effectively one identifiable patient's opinion of
 * one identifiable clinician. Suppressing the number is the whole point —
 * publishing a per-provider average over two visits re-identifies the rater.
 */
export const MIN_RATINGS_TO_REPORT = 5;

export interface RatingAggregate {
  /** Null when suppressed for small N — distinct from a genuine zero. */
  avgPatientRating: number | null;
  avgTechnicalRating: number | null;
  patientResponses: number;
  providerResponses: number;
  eligible: number;
  /** Share of completed sessions where the patient left a rating, 0–100. */
  patientResponseRate: number;
  suppressed: boolean;
}

/**
 * Aggregate ratings over a set of sessions, suppressing small groups.
 *
 * Takes sessions rather than fetching them so the caller controls scope — this
 * is used per-provider, per-facility and per-period, and each of those has a
 * different idea of which sessions belong in the denominator.
 */
export function aggregateRatings(sessions: TelehealthSessionDoc[]): RatingAggregate {
  // Only completed visits can be rated, so they are the honest denominator for
  // a response rate; including cancelled ones would understate it.
  const eligible = sessions.filter(s => s.status === 'completed');
  const patient = eligible.filter(s => s.patientRating !== undefined).map(s => s.patientRating!);
  const technical = eligible.filter(s => s.providerTechnicalRating !== undefined)
    .map(s => s.providerTechnicalRating!);

  const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const suppressed = patient.length < MIN_RATINGS_TO_REPORT;

  return {
    avgPatientRating: suppressed ? null : mean(patient),
    avgTechnicalRating: technical.length < MIN_RATINGS_TO_REPORT ? null : mean(technical),
    patientResponses: patient.length,
    providerResponses: technical.length,
    eligible: eligible.length,
    patientResponseRate: eligible.length > 0
      ? Math.round((patient.length / eligible.length) * 100)
      : 0,
    suppressed,
  };
}

// Statistics for dashboards
export async function getTelehealthStats(scope?: DataScope) {
  const all = await getAllSessions(scope);
  const today = jubaDate();
  const todaySessions = all.filter(s => s.scheduledDate === today);
  const completed = all.filter(s => s.status === 'completed');
  const ratings = completed.filter(s => s.patientRating).map(s => s.patientRating!);

  return {
    total: all.length,
    todayTotal: todaySessions.length,
    todayActive: todaySessions.filter(s => s.status === 'in_session' || s.status === 'waiting_room').length,
    todayCompleted: todaySessions.filter(s => s.status === 'completed').length,
    completedTotal: completed.length,
    cancelledTotal: all.filter(s => s.status === 'cancelled').length,
    failedTotal: all.filter(s => s.status === 'failed').length,
    avgDuration: completed.length > 0
      ? Math.round(completed.reduce((sum, s) => sum + (s.duration || 0), 0) / completed.length)
      : 0,
    avgRating: ratings.length > 0
      ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10
      : 0,
    avgConnectionDrops: completed.length > 0
      ? Math.round((completed.reduce((sum, s) => sum + s.connectionDrops, 0) / completed.length) * 10) / 10
      : 0,
    // Derived from the stored sessions, not a literal (KAN-141). Seeded with
    // every member of the TelehealthType union so a modality with no sessions
    // still reports 0 rather than vanishing from the breakdown, and a new
    // modality cannot silently go uncounted.
    byType: all.reduce<Record<TelehealthType, number>>(
      (acc, s) => { acc[s.sessionType] = (acc[s.sessionType] || 0) + 1; return acc; },
      { video: 0, audio: 0, chat: 0 },
    ),
    followUpRate: completed.length > 0
      ? Math.round((completed.filter(s => s.followUpRequired).length / completed.length) * 100)
      : 0,
  };
}
