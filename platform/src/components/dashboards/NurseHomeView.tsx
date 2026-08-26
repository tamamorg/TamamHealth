'use client';

import { useAuth } from '@/lib/context';
import EhrClinicalDashboard, {
  type WorklistPatient,
  type OutstandingItem,
  type OutstandingEntry,
} from '@/components/ehr/EhrClinicalDashboard';
import type { DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { usePatients } from '@/lib/hooks/usePatients';
import { useTriage } from '@/lib/hooks/useTriage';
import { useWards } from '@/lib/hooks/useWards';
import { useRooming } from '@/lib/hooks/useRooming';
import { useHandoffs } from '@/lib/hooks/useHandoffs';
import { useFollowUpsDue } from '@/lib/hooks/useFollowUpsDue';
import { useMarEntries, type MAREntry } from '@/components/nurse/shared';
import { patientDisplayName, patientAge, shortenPersonName } from '@/lib/patient-utils';
import type { PatientDoc, TriageDoc, FollowUpDoc, ShiftHandoffDoc } from '@/lib/db-types';
import type { AdmissionDoc } from '@/lib/db-types-ward';
import type { RoomingWorklistEntry } from '@/lib/services/rooming-service';
import { toIsoDate } from '@/lib/date-utils';

// Same due-window as the doctor worklist's "Follow-ups due" rail (see
// DoctorDashboardPage.tsx) — a community-health follow-up counts as "due" here
// when it's scheduled today or within this many days out.
const FOLLOW_UP_DUE_WINDOW_DAYS = 3;

// A rooming/triage wait past this many minutes gets flagged danger rather than
// warning — mirrors the doctor worklist's `isTransferOverdue` idea (a queue
// item that's been waiting too long outranks an ordinary "needs attention").
// Rooming is meant to take minutes, not the better part of an hour.
const ROOMING_OVERDUE_MINUTES = 60;

// Human label for each step `getRoomingWorklist` reports, reused for both the
// worklist row's `ward` column and the "Rooming queue" outstanding entry.
const ROOMING_STEP_LABEL: Record<RoomingWorklistEntry['step'], string> = {
  awaiting_triage: 'Awaiting triage',
  awaiting_arrival: 'Awaiting arrival',
  awaiting_rooming: 'Awaiting rooming',
  being_roomed: 'Being roomed',
};

export interface NurseWorklistInput {
  currentUser: { _id: string; name?: string };
  patients: PatientDoc[];
  /** Active (status === 'admitted') admissions only — `useWards().activeAdmissions`. */
  admissions: AdmissionDoc[];
  triages: TriageDoc[];
  /** `useRooming().entries` — already excludes `ready_for_clinician` (that
   *  patient has graduated to the doctor's worklist; see rooming-service.ts). */
  roomingEntries: RoomingWorklistEntry[];
  /** `useMarEntries().marEntries` — each dose's status is already resolved
   *  against the real administrations[] record and the wall clock. */
  marEntries: MAREntry[];
  /** `useHandoffs().handoffs` — every handoff visible to this user, newest first. */
  handoffs: ShiftHandoffDoc[];
  followUpsDue: FollowUpDoc[];
  /** Injectable so callers (tests) get a deterministic "today" instead of the
   *  real wall clock. Defaults to `new Date()`. */
  now?: Date;
}

export interface NurseWorklistResult {
  /** Ward roster rows + rooming-queue rows, deduped by patient — what
   *  EhrClinicalDashboard's `patients` prop expects. */
  patients: WorklistPatient[];
  outstanding: OutstandingItem[];
  /** Week bars for the day-activity chart — admissions and arrivals, since a
   *  nurse has no appointment schedule for it to be derived from. */
  activity: DayStatsItem[];
}

function shortDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

/**
 * Assembles the signed-in nurse/midwife/triage-nurse/rooming-nurse's
 * worklist: today's ward roster, the rooming queue (which already spans
 * everyone from just-checked-in through mid-rooming — see
 * `ROOMING_WORKLIST_STATUSES` in rooming-service.ts), medications due, shift
 * handoffs to acknowledge, and follow-ups due.
 *
 * Pure, same shape/testability as `assembleDoctorWorklist`: every input is
 * already the resolved output of a scoped hook, so this only combines what
 * it's handed — it never does its own org/facility filtering, and it never
 * re-derives a dose's due/overdue status (that's `useMarEntries`' job,
 * against the real administrations[] record and the wall clock — the same
 * trust model `assembleDoctorWorklist` gives `resumableEncounters`).
 */
export function assembleNurseWorklist(input: NurseWorklistInput): NurseWorklistResult {
  const {
    currentUser, patients, admissions, triages, roomingEntries,
    marEntries, handoffs, followUpsDue,
  } = input;
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const todayIso = toIsoDate(now);

  const patientById = new Map(patients.map(p => [p._id, p]));

  // Today's triage priority per patient — same "day's max, RED beats YELLOW
  // beats GREEN" rule the doctor worklist uses, so acuity reads the same way
  // across every role's dashboard.
  const triagePriorityByPatient: Record<string, 'RED' | 'YELLOW' | 'GREEN'> = {};
  {
    const rank = { RED: 3, YELLOW: 2, GREEN: 1 } as const;
    for (const tr of triages) {
      if (!(tr.triagedAt || '').startsWith(todayIso)) continue;
      const prev = triagePriorityByPatient[tr.patientId];
      if (!prev || rank[tr.priority] > rank[prev]) triagePriorityByPatient[tr.patientId] = tr.priority;
    }
  }
  // Fallback acuity for an admitted patient with no triage record today —
  // mirrors `severityAcuity` in components/nurse/shared.tsx.
  const severityAcuity = (severity: AdmissionDoc['severity']): 'RED' | 'YELLOW' | 'GREEN' | undefined => {
    if (severity === 'critical') return 'RED';
    if (severity === 'severe') return 'YELLOW';
    if (severity === 'moderate' || severity === 'mild') return 'GREEN';
    return undefined;
  };
  // Most recent triage doc per patient (any status) — feeds the ward row's
  // "nurse" column when the admission itself carries no `nurseAssignedName`.
  const latestTriageByPatient = new Map<string, TriageDoc>();
  for (const tr of triages) {
    const held = latestTriageByPatient.get(tr.patientId);
    if (!held || tr.triagedAt > held.triagedAt) latestTriageByPatient.set(tr.patientId, tr);
  }

  // A patient must never appear twice in the worklist table. Ward rows are
  // built first and claim their patientId here; rooming rows for the same
  // patientId (which can happen if an admission's source encounter wasn't
  // closed out) are skipped rather than shown a second time.
  const seenPatientIds = new Set<string>();

  // ── Ward roster: one row per active admission ──
  const wardRows: WorklistPatient[] = [];
  for (const admission of admissions) {
    if (seenPatientIds.has(admission.patientId)) continue; // one row per patient
    seenPatientIds.add(admission.patientId);
    const doc = patientById.get(admission.patientId);
    wardRows.push({
      _id: admission.patientId,
      photoUrl: doc?.photoUrl,
      name: doc ? patientDisplayName(doc) : shortenPersonName(admission.patientName),
      // No demo age/gender sampling for nurses: unknown stays unknown rather
      // than being invented for visual richness.
      age: doc ? patientAge(doc) : null,
      gender: doc?.gender?.[0] || '',
      id: doc?.hospitalNumber || admission.hospitalNumber || '',
      ward: admission.wardName + (admission.bedNumber ? ` · ${admission.bedNumber}` : ''),
      division: admission.wardName,
      doctor: admission.attendingPhysicianName || '',
      assignedDoctor: admission.attendingPhysician || undefined,
      assignedDoctorName: admission.attendingPhysicianName || undefined,
      nurse: admission.nurseAssignedName || latestTriageByPatient.get(admission.patientId)?.triagedByName || '',
      triagePriority: triagePriorityByPatient[admission.patientId] || severityAcuity(admission.severity),
    });
  }

  // ── Rooming queue: everyone from just-checked-in through mid-rooming who
  // isn't yet admitted. `getRoomingWorklist` already excludes
  // `ready_for_clinician` — that patient belongs to the doctor's worklist now. ──
  const roomingRows: WorklistPatient[] = [];
  for (const entry of roomingEntries) {
    const patientId = entry.encounter.patientId;
    if (!patientId || seenPatientIds.has(patientId)) continue;
    seenPatientIds.add(patientId);
    const doc = patientById.get(patientId);
    roomingRows.push({
      _id: patientId,
      photoUrl: doc?.photoUrl,
      name: doc ? patientDisplayName(doc) : shortenPersonName(entry.encounter.patientName),
      age: doc ? patientAge(doc) : null,
      gender: doc?.gender?.[0] || '',
      id: doc?.hospitalNumber || entry.encounter.hospitalNumber || '',
      ward: entry.encounter.roomNumber ? `Room ${entry.encounter.roomNumber}` : ROOMING_STEP_LABEL[entry.step],
      division: ROOMING_STEP_LABEL[entry.step],
      doctor: '',
      nurse: '',
      triagePriority: triagePriorityByPatient[patientId],
    });
  }

  // ── Outstanding: medications due ──
  // Only doses tied to a patient's ACTIVE admission — the MAR deep link needs
  // an admissionId, and a dose for a patient with no active admission has no
  // bedside MAR grid to open.
  const admissionByPatient = new Map<string, AdmissionDoc>();
  for (const a of admissions) if (!admissionByPatient.has(a.patientId)) admissionByPatient.set(a.patientId, a);

  const dueMeds = marEntries
    .filter(e => (e.status === 'due' || e.status === 'overdue') && admissionByPatient.has(e.patientId))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'overdue' ? -1 : 1));
  const medEntries: OutstandingEntry[] = dueMeds.map(e => {
    const admissionId = admissionByPatient.get(e.patientId)!._id;
    const href = `/wards/mar/${admissionId}`;
    return {
      id: e.id,
      title: shortenPersonName(e.patientName),
      subtitle: `${e.medication} ${e.dose} · ${e.route} · ${e.time}`,
      meta: e.status === 'overdue' ? 'Overdue' : 'Due now',
      tone: e.status === 'overdue' ? ('danger' as const) : ('warning' as const),
      href,
      actionLabel: 'Open MAR',
      actionHref: href,
    };
  });

  // ── Outstanding: handoffs to acknowledge ──
  // 'signed' = not yet acknowledged. The nurse who signed a handoff never
  // needs to acknowledge her own — that's the oncoming nurse's job.
  const unacknowledgedHandoffs = handoffs.filter(
    h => h.status === 'signed' && h.outgoingNurseId !== currentUser._id,
  );
  const handoffEntries: OutstandingEntry[] = unacknowledgedHandoffs.map(h => ({
    id: h._id,
    title: `${h.shift.charAt(0).toUpperCase()}${h.shift.slice(1)} shift handoff`,
    subtitle: `From ${h.outgoingNurseName} · ${h.patients.length} patient${h.patients.length === 1 ? '' : 's'}`,
    meta: shortDate(h.signedAt),
    tone: 'warning' as const,
    href: '/wards/handoff',
    actionLabel: 'Acknowledge handoff',
    actionHref: '/wards/handoff',
  }));

  // ── Outstanding: rooming queue ──
  // Same entries as the `roomingRows` above, restated as an action rail so a
  // nurse can see the count and jump straight to the next patient to room —
  // there's no separate /rooming list page (only the per-patient route), so
  // this card is the queue's only cross-patient view.
  const roomingQueueEntries: OutstandingEntry[] = roomingEntries.map(entry => {
    const patientId = entry.encounter.patientId;
    const doc = patientId ? patientById.get(patientId) : undefined;
    const overdue = entry.waitingMinutes >= ROOMING_OVERDUE_MINUTES;
    return {
      id: entry.encounter._id,
      title: doc ? patientDisplayName(doc) : shortenPersonName(entry.encounter.patientName),
      subtitle: `${ROOMING_STEP_LABEL[entry.step]} · ${entry.waitingMinutes} min`,
      meta: overdue ? 'Overdue' : '',
      tone: overdue ? ('danger' as const) : ('warning' as const),
      href: `/rooming/${patientId}`,
      actionLabel: 'Continue rooming',
      actionHref: `/rooming/${patientId}`,
    };
  });

  // ── Outstanding: follow-ups due ──
  // Identical window/filter to the doctor worklist's "Follow-ups due" rail —
  // community-health follow-ups are nursing work too.
  const dueCutoffMs = nowMs + FOLLOW_UP_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const dueFollowUps = followUpsDue.filter(f => {
    if (f.status !== 'active') return false;
    const scheduledMs = f.scheduledDate ? new Date(f.scheduledDate).getTime() : NaN;
    return !Number.isNaN(scheduledMs) && scheduledMs <= dueCutoffMs;
  });
  const followUpEntries: OutstandingEntry[] = dueFollowUps.map(f => ({
    id: f._id,
    title: shortenPersonName(f.patientName),
    subtitle: f.condition,
    meta: shortDate(f.scheduledDate),
    tone: 'warning' as const,
    href: `/patients/${f.patientId}?tab=careChecklist`,
    actionLabel: 'Complete follow-up',
    actionKind: 'complete-follow-up' as const,
  }));

  const outstandingItems: OutstandingItem[] = [
    {
      label: 'Medications due',
      count: dueMeds.length,
      tone: dueMeds.some(e => e.status === 'overdue')
        ? ('danger' as const)
        : dueMeds.length > 0 ? ('warning' as const) : ('neutral' as const),
      entries: medEntries,
    },
    {
      label: 'Handoffs to acknowledge',
      count: unacknowledgedHandoffs.length,
      tone: unacknowledgedHandoffs.length > 0 ? ('warning' as const) : ('neutral' as const),
      href: '/wards/handoff',
      entries: handoffEntries,
    },
    {
      label: 'Rooming queue',
      count: roomingEntries.length,
      tone: roomingEntries.some(e => e.waitingMinutes >= ROOMING_OVERDUE_MINUTES)
        ? ('danger' as const)
        : roomingEntries.length > 0 ? ('warning' as const) : ('neutral' as const),
      entries: roomingQueueEntries,
    },
    {
      label: 'Follow-ups due',
      count: dueFollowUps.length,
      tone: dueFollowUps.length > 0 ? ('warning' as const) : ('neutral' as const),
      entries: followUpEntries,
    },
  ];

  return {
    patients: [...wardRows, ...roomingRows],
    outstanding: outstandingItems,
    activity: assembleNurseWeekActivity(admissions, triages),
  };
}

/**
 * Week bars for the day-activity chart, in nursing terms.
 *
 * The chart's schedule-derived form is built from the signed-in clinician's
 * own appointments; a nurse holds none, so it rendered "No activity this week"
 * on a ward that had been busy all week. A nurse's week is the two events they
 * actually run: patients admitted to a bed, and patients arriving to be
 * triaged.
 *
 * Series 0 = Admitted, series 1 = Arrivals. A triage that ended in an
 * admission the same day is counted once, as the admission — otherwise one
 * patient walking in and being admitted would raise two bars.
 */
export function assembleNurseWeekActivity(
  admissions: AdmissionDoc[],
  triages: TriageDoc[],
): DayStatsItem[] {
  const dayOf = (iso?: string) => (iso || '').slice(0, 10);
  const admittedOnDay = new Set(
    admissions.map(a => `${a.patientId}:${dayOf(a.admissionDate)}`),
  );

  const items: DayStatsItem[] = [];
  for (const admission of admissions) {
    const date = dayOf(admission.admissionDate);
    if (date) items.push({ date, series: 0 });
  }
  for (const triage of triages) {
    const date = dayOf(triage.triagedAt);
    if (!date) continue;
    if (admittedOnDay.has(`${triage.patientId}:${date}`)) continue;
    items.push({ date, time: triage.triagedAt.slice(11, 16), series: 1 });
  }
  return items;
}

export default function NurseHomeView() {
  const { currentUser } = useAuth();
  const { patients } = usePatients();
  const { triages } = useTriage();
  const { activeAdmissions } = useWards();
  const { entries: roomingEntries } = useRooming();
  const { marEntries } = useMarEntries();
  const { handoffs } = useHandoffs();
  const { followUpsDue } = useFollowUpsDue();

  // DashboardPage only renders this view once currentUser is loaded and its
  // role has been checked — this guard is purely for TypeScript's benefit.
  if (!currentUser) return null;

  const worklist = assembleNurseWorklist({
    currentUser, patients, admissions: activeAdmissions, triages,
    roomingEntries, marEntries, handoffs, followUpsDue,
  });

  return (
    <main className="page-container page-enter">
      <EhrClinicalDashboard
        clinicianName={currentUser.name || 'nurse'}
        patients={worklist.patients}
        // Scoped by useAppointments. This restores ANC and general nursing
        // schedules that were visible to the retired specialist roles but
        // absent from the shared nurse dashboard.
        appointments={null}
        outstanding={worklist.outstanding}
        activityItems={worklist.activity}
        activitySeriesNames={['Admitted', 'Arrivals']}
      />
    </main>
  );
}
