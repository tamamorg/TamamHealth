'use client';

import { useAuth } from '@/lib/context';
import EhrClinicalDashboard, {
  type WorklistPatient,
  type OutstandingItem,
  type OutstandingEntry,
} from '@/components/ehr/EhrClinicalDashboard';
import { usePatients } from '@/lib/hooks/usePatients';
import { useResumableEncounters, type ResumableEncounter } from '@/lib/hooks/useResumableEncounters';
import { useSigningInbox } from '@/lib/hooks/useSigningInbox';
import { computeSignCount } from '@/lib/hooks/signing-inbox-math';
import { usePhoneNotesInbox } from '@/lib/hooks/usePhoneNotesInbox';
import { useTriage } from '@/lib/hooks/useTriage';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useFollowUpsDue } from '@/lib/hooks/useFollowUpsDue';
import { patientFullName, patientDisplayName, shortenPersonName, patientAge } from '@/lib/patient-utils';
import { getNoteType } from '@/lib/clinical-notes/note-catalog';
import { useTransferQueue } from '@/lib/hooks/usePatientTransfers';
import { describeAssignment, isTransferOverdue } from '@/lib/services/patient-transfer-service';
import type {
  AppointmentDoc,
  AssessmentDoc,
  MedicalRecordDoc,
  FollowUpDoc,
  PatientDoc,
  PatientTransferDoc,
  PhoneNoteDoc,
  ReferralDoc,
  TriageDoc,
} from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { toIsoDate } from '@/lib/date-utils';

const DEPARTMENTS = ['OPD', 'Emergency', 'Maternity', 'Pediatrics', 'Surgery', 'Lab', 'Pharmacy', 'ICU'];

// A community-health follow-up counts as "due" on this worklist when it's
// scheduled today or within this many days out — close enough that the
// clinician should know before it lapses into a missed home visit.
const FOLLOW_UP_DUE_WINDOW_DAYS = 3;

// Demo data must be explicitly enabled — same rule as nurse/shared.tsx, which
// learned it the hard way: treating an ABSENT environment value as demo mode
// leaked fabricated ward/division labels into otherwise real facilities
// (NEXT_PUBLIC_* is inlined at build time, so a build that forgot the var
// shipped demo data to production).
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export interface DoctorWorklistInput {
  patients: PatientDoc[];
  triages: TriageDoc[];
  currentUser: { _id: string; name?: string };
  appointments: AppointmentDoc[];
  unsignedDrafts: MedicalRecordDoc[];
  awaitingCosign: MedicalRecordDoc[];
  heldAssessments: AssessmentDoc[];
  unsignedNotes: ClinicalNoteDoc[];
  phoneNotesInbox: PhoneNoteDoc[];
  referrals: ReferralDoc[];
  resumableEncounters: ResumableEncounter[];
  incomingTransfers: PatientTransferDoc[];
  followUpsDue: FollowUpDoc[];
  /** Injectable so callers (tests) get a deterministic "today" / cutoff instead
   *  of the real wall clock. Defaults to `new Date()`. */
  now?: Date;
}

export interface DoctorWorklistResult {
  /** Assigned + unclaimed-but-triaged rows, combined — what EhrClinicalDashboard's `patients` prop expects. */
  patients: WorklistPatient[];
  /** This clinician's own appointments (closed ones included, for the Finished lane). */
  appointments: AppointmentDoc[];
  outstanding: OutstandingItem[];
}

/**
 * Assembles the signed-in doctor/clinical-officer/clinician's worklist: their
 * assigned patients, PLUS any active-triage walk-in nobody has claimed yet
 * (previously invisible to every doctor at the facility — see
 * `unclaimedTriaged` below), their schedule, and the "outstanding items" rail
 * (documents to sign, phone notes, referrals, labs, transfers).
 *
 * Pure: every input is already the resolved output of a scoped hook
 * (`usePatients`, `useTriage`, … — tenancy is enforced there, by
 * `filterByScope`), so this only has to combine what it's handed without
 * doing any org/facility filtering of its own — and without ever pulling in
 * a patient that isn't already in `input.patients`.
 */
export function assembleDoctorWorklist(input: DoctorWorklistInput): DoctorWorklistResult {
  const {
    patients, triages, currentUser, appointments,
    unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes,
    phoneNotesInbox, referrals, resumableEncounters, incomingTransfers,
    followUpsDue,
  } = input;
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const todayIso = toIsoDate(now);

  // Resolve a patient display name for the signing inbox from the loaded roster.
  const signingPatientName = (patientId: string): string => {
    const p = patients.find((pt) => pt._id === patientId);
    return p ? patientFullName(p) : patientId;
  };

  // Today's triage priority per patient, so the worklist can lead with acuity.
  const triagePriorityByPatient: Record<string, 'RED' | 'YELLOW' | 'GREEN'> = {};
  {
    const rank = { RED: 3, YELLOW: 2, GREEN: 1 } as const;
    for (const tr of triages) {
      if (!(tr.triagedAt || '').startsWith(todayIso)) continue;
      const prev = triagePriorityByPatient[tr.patientId];
      if (!prev || rank[tr.priority] > rank[prev]) triagePriorityByPatient[tr.patientId] = tr.priority;
    }
  }

  // Patients a nurse has assigned to this clinician for care.
  const myAssigned = patients
    .filter(p => p.assignedDoctor === currentUser._id && p.assignmentStatus !== 'completed')
    .sort((a, b) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''));

  // Active (pending/seen), unclaimed triage records at this clinician's own
  // facility. `myAssigned` above only ever surfaces patients a nurse (or a
  // prior claim) already stamped with THIS doctor's id — a triaged walk-in
  // nobody has assigned yet gets no `assignedDoctor` at all, so it existed on
  // no doctor's worklist. `triages` (useTriage()) is already org/hospital-
  // scoped, so this stays inside the viewer's own facility/org. Windowed to
  // the last 24h to match EhrClinicalDashboard's own "active triage" cutoff —
  // a row seeded here should also resolve a live queue entry there.
  const latestActiveTriageByPatient = new Map<string, TriageDoc>();
  {
    const cutoff = nowMs - 24 * 60 * 60 * 1000;
    for (const tr of triages) {
      if (tr.status !== 'pending' && tr.status !== 'seen') continue;
      if (new Date(tr.triagedAt).getTime() < cutoff) continue;
      // triages is newest-first (getAllTriage sorts by triagedAt desc) — keep
      // only the first (latest) triage doc seen per patient.
      if (!latestActiveTriageByPatient.has(tr.patientId)) latestActiveTriageByPatient.set(tr.patientId, tr);
    }
  }

  // The triage handoff names its provider on the TRIAGE record
  // (`assignedProviderId`) — the patient document's `assignedDoctor` is
  // reception's field and is deliberately not written at triage (the
  // care-team two-doc model). "Mine" must therefore read BOTH: reading only
  // `patient.assignedDoctor` meant a walk-in the nurse handed to THIS
  // clinician was filtered off their board by the default "only my patients"
  // toggle, while the front desk showed the same visit In Facility — the two
  // boards disagreed about who was in the building.
  const triageAssignedToMe = patients.filter(p =>
    !p.assignedDoctor
    && latestActiveTriageByPatient.get(p._id)?.assignedProviderId === currentUser._id);

  // A patient with BOTH an assignedDoctor (any doctor, not just this viewer)
  // AND an active triage only ever shows up via `myAssigned` above — the
  // `!p.assignedDoctor` guard here is what keeps them from ALSO appearing as
  // an unclaimed row, i.e. showing twice. A triage whose handoff already
  // names a provider is NOT unclaimed either: it surfaces on that provider's
  // board (above), not as a claimable row on every doctor's.
  const unclaimedTriaged = patients.filter(p => {
    const tr = latestActiveTriageByPatient.get(p._id);
    // `returned_to_desk` is excluded even though its provider is cleared: the
    // desk owns that visit now, so it is not claimable clinical work.
    return !!tr && !p.assignedDoctor && !tr.assignedProviderId
      && tr.handoffStatus !== 'returned_to_desk';
  });

  // Worklist rows: patients assigned to the signed-in clinician. Ward/division
  // are sampled in demo mode for visual richness and left blank in production.
  const assignedRows = myAssigned.map((p, i) => ({
    _id: p._id,
    firstName: p.firstName,
    surname: p.surname,
    photoUrl: p.photoUrl,
    payorInfo: p.payorInfo,
    name: patientDisplayName(p),
    // null when unknown — the row renders '—'. Never invented: the old
    // `?? (25 + i * 3)` fallback printed a fabricated age in production.
    age: patientAge(p),
    gender: p.gender?.[0] || (IS_DEMO ? (i % 2 === 0 ? 'M' : 'F') : ''),
    id: p.hospitalNumber,
    admittedAt: p.assignedAt || p.registeredAt || p.registrationDate,
    ward: IS_DEMO ? DEPARTMENTS[i % DEPARTMENTS.length] + '-' + (i + 1) : '',
    doctor: currentUser.name || '',
    assignedDoctor: p.assignedDoctor,
    assignedDoctorName: p.assignedDoctorName,
    nurse: p.assignedNurseName || '',
    division: IS_DEMO ? DEPARTMENTS[i % DEPARTMENTS.length] : '',
    triagePriority: triagePriorityByPatient[p._id],
  }));

  // Rows for the patients a nurse handed to THIS clinician at triage. Shaped
  // like `assignedRows` — `assignedDoctor` carries the viewer's id (from the
  // triage handoff, a view-model fact, never written back to the patient
  // document) so the row reads as assigned care AND survives
  // buildUnifiedPatientRows' "only my patients" filter.
  const triageAssignedRows = triageAssignedToMe.map((p, i) => {
    const tr = latestActiveTriageByPatient.get(p._id);
    return {
      _id: p._id,
      firstName: p.firstName,
      surname: p.surname,
      photoUrl: p.photoUrl,
      payorInfo: p.payorInfo,
      name: patientDisplayName(p),
      age: patientAge(p),
      gender: p.gender?.[0] || (IS_DEMO ? (i % 2 === 0 ? 'M' : 'F') : ''),
      id: p.hospitalNumber,
      admittedAt: tr?.triagedAt || p.registeredAt || p.registrationDate,
      ward: IS_DEMO ? DEPARTMENTS[i % DEPARTMENTS.length] + '-' + (i + 1) : '',
      doctor: currentUser.name || '',
      assignedDoctor: currentUser._id,
      assignedDoctorName: tr?.assignedProviderName || currentUser.name,
      nurse: p.assignedNurseName || tr?.triagedByName || '',
      division: IS_DEMO ? DEPARTMENTS[i % DEPARTMENTS.length] : '',
      triagePriority: triagePriorityByPatient[p._id] || tr?.priority,
    };
  });

  // Same row shape as `assignedRows`, but for a triaged patient nobody has
  // claimed yet: no `doctor`/`assignedDoctor`. EhrClinicalDashboard already
  // renders a patient-sourced row with no assignedDoctor as "Doctor
  // unassigned" — its existing vocabulary for this, not a new one — and its
  // worklist row's claim action already stamps `assignedDoctor` on whichever
  // clinician opens it, so surfacing the row here is enough to make it both
  // visible and claimable.
  const unassignedRows = unclaimedTriaged.map((p, i) => {
    const tr = latestActiveTriageByPatient.get(p._id);
    return {
      _id: p._id,
      firstName: p.firstName,
      surname: p.surname,
      photoUrl: p.photoUrl,
      payorInfo: p.payorInfo,
      name: patientDisplayName(p),
      // null when unknown — the row renders '—'. Never invented: the old
    // `?? (25 + i * 3)` fallback printed a fabricated age in production.
    age: patientAge(p),
      gender: p.gender?.[0] || (IS_DEMO ? (i % 2 === 0 ? 'M' : 'F') : ''),
      id: p.hospitalNumber,
      admittedAt: tr?.triagedAt || p.registeredAt || p.registrationDate,
      ward: IS_DEMO ? DEPARTMENTS[i % DEPARTMENTS.length] + '-' + (i + 1) : '',
      doctor: '',
      /* The nurse COVERING the patient first; the one who triaged them only
         as a fallback. These are different people, and reading the triager as
         "the nurse" is the same confusion `assignedNurseName` was added to
         end — see its comment on the Patient type. The assigned row above
         already read the right field; this one did not. */
      nurse: p.assignedNurseName || tr?.triagedByName || '',
      division: IS_DEMO ? DEPARTMENTS[i % DEPARTMENTS.length] : '',
      triagePriority: triagePriorityByPatient[p._id] || tr?.priority,
    };
  });

  // Total documents awaiting the clinician's signature.
  const signCount = computeSignCount({ unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes });

  // All of this clinician's appointments, closed ones included, for the
  // schedule board — its Finished lane is fed by completed/cancelled/no-show
  // rows, so dropping them here would pin that lane at zero and make a visit
  // vanish from the board the moment it is checked out.
  const apptKey = (a: { appointmentDate: string; appointmentTime?: string }) => `${a.appointmentDate}T${a.appointmentTime || '00:00'}`;
  const myAppts = (appointments || [])
    .filter(a => a.providerId === currentUser._id)
    .sort((x, y) => apptKey(x).localeCompare(apptKey(y)));
  // Still-live bookings only — where a completed or
  // cancelled visit is no longer something to join.
  // Per-item worklists behind the outstanding counts.
  const shortDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const patientIds = new Set(patients.map(p => p._id));

  // Every row lands on the DOCUMENT it names, not on a tab that merely contains
  // documents of that kind. All four used to point at the patient's Notes tab
  // (or, for assessments, a tab they don't even live on), so a clinician with
  // nine things to sign arrived nine times at the same list and had to work out
  // which row the dashboard had meant. The chart's `?tab=&focus=` deep link
  // expands, scrolls to and highlights the exact record.
  const documentEntries: OutstandingEntry[] = [
    ...unsignedDrafts.map(r => {
      // A consult record is a VISIT — it is signed on the Visits timeline,
      // where RecordSignatureBar now renders, not on the Notes tab.
      const href = `/patients/${r.patientId}?tab=history&focus=${r._id}`;
      return {
        id: r._id,
        title: signingPatientName(r.patientId),
        subtitle: 'Draft consult note — needs signature',
        meta: shortDate(r.visitDate || r.createdAt),
        tone: 'warning' as const,
        href,
        actionLabel: 'Review & sign',
        actionHref: href,
      };
    }),
    ...awaitingCosign.map(r => {
      const href = `/patients/${r.patientId}?tab=history&focus=${r._id}`;
      return {
        id: r._id,
        title: signingPatientName(r.patientId),
        subtitle: 'Trainee note — awaiting co-signature',
        meta: shortDate(r.visitDate || r.createdAt),
        tone: 'warning' as const,
        href,
        actionLabel: 'Review & co-sign',
        actionHref: href,
      };
    }),
    ...heldAssessments.map(a => {
      // Assessments render in AssessmentsPanel on the Care plan tab.
      const href = `/patients/${a.patientId}?tab=careChecklist&focus=${a._id}`;
      return {
        id: a._id,
        title: signingPatientName(a.patientId),
        subtitle: `${a.instrumentName || 'Outcome assessment'} — review & sign`,
        meta: shortDate(a.createdAt),
        tone: 'warning' as const,
        href,
        actionLabel: 'Review & sign',
        actionHref: href,
      };
    }),
    ...unsignedNotes.map(n => ({
      id: n._id,
      title: shortenPersonName(n.patientName),
      subtitle: `${getNoteType(n.noteType).label} note — needs signature`,
      meta: shortDate(n.serviceDate || n.createdAt),
      tone: 'warning' as const,
      // Already exact: /notes/[id] IS the note, opened in the full editor that
      // owns the Sign action.
      href: `/notes/${n._id}`,
      actionLabel: 'Review & sign',
      actionHref: `/notes/${n._id}`,
    })),
  ];

  const phoneNoteEntries = phoneNotesInbox.map(n => ({
    id: n._id,
    title: shortenPersonName(n.patientName || n.callerName) || 'Phone note',
    subtitle: n.subject || n.message,
    meta: shortDate(n.createdAt),
    tone: 'warning' as const,
    // Opens the patient's own notes tab — where the callback actually gets
    // resolved — rather than /messages, which has no per-patient context.
    href: n.patientId ? `/patients/${n.patientId}?tab=notes` : '/patients',
    actionLabel: 'Open callback',
    actionHref: n.patientId ? `/patients/${n.patientId}?tab=notes` : '/patients',
  }));

  // "Open" = submitted but not yet resolved — excludes completed/cancelled
  // referrals, which don't need any more action from the referring clinician.
  const OPEN_REFERRAL_STATUSES = new Set(['sent', 'received', 'seen']);
  const myOpenReferrals = (referrals || [])
    .filter(r => r.createdBy === currentUser._id && OPEN_REFERRAL_STATUSES.has(r.status));
  const referralEntries = myOpenReferrals.map(r => ({
    id: r._id,
    title: shortenPersonName(r.patientName),
    subtitle: `${r.reason || 'Referral'} → ${r.toHospital || 'receiving facility'}`,
    meta: r.status ? String(r.status).replace(/_/g, ' ') : '',
    href: patientIds.has(r.patientId)
      ? `/patients/${r.patientId}?tab=referrals`
      : `/referrals?patient=${encodeURIComponent(r.patientId)}`,
    actionLabel: 'Review referral',
    actionHref: patientIds.has(r.patientId)
      ? `/patients/${r.patientId}?tab=referrals`
      : `/referrals?patient=${encodeURIComponent(r.patientId)}`,
  }));

  const labEntries = resumableEncounters.map(e => ({
    id: e._id,
    title: shortenPersonName(e.patientName),
    subtitle: e.allResultsBack
      ? 'All results back — resume the visit'
      : `${e.resultsReady} of ${e.resultsTotal} results back`,
    meta: shortDate(e.createdAt),
    tone: e.allResultsBack ? ('danger' as const) : ('neutral' as const),
    href: e.allResultsBack ? `/consultation?encounter=${e._id}` : `/patients/${e.patientId}?tab=labs`,
    actionLabel: e.allResultsBack ? 'Resume visit' : 'Review labs',
    actionHref: e.allResultsBack ? `/consultation?encounter=${e._id}` : `/patients/${e.patientId}?tab=labs`,
  }));

  // Community-health follow-ups due (or nearly due) for this clinician's org/
  // hospital. `followUpsDue` (useFollowUpsDue) already scopes and pre-filters
  // for the live app, but the window check is re-applied here against the
  // injected `now` so this stays a pure, deterministic function of its
  // inputs — same reasoning as the triage 24h cutoff and the
  // "today" filter above, both computed in the assembler rather than a hook.
  const dueCutoffMs = nowMs + FOLLOW_UP_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const dueFollowUps = followUpsDue.filter(f => {
    if (f.status !== 'active') return false;
    const scheduledMs = f.scheduledDate ? new Date(f.scheduledDate).getTime() : NaN;
    return !Number.isNaN(scheduledMs) && scheduledMs <= dueCutoffMs;
  });
  const followUpEntries = dueFollowUps.map(f => ({
    id: f._id,
    title: shortenPersonName(f.patientName),
    subtitle: f.condition,
    meta: shortDate(f.scheduledDate),
    tone: 'warning' as const,
    href: `/patients/${f.patientId}?tab=careChecklist`,
    actionLabel: 'Complete follow-up',
    actionKind: 'complete-follow-up' as const,
  }));

  const transferEntries = incomingTransfers.map(t => {
    const overdue = isTransferOverdue(t, now);
    return {
      id: t._id,
      title: t.patientName || 'Patient',
      subtitle: `${describeAssignment(t.from)} → you · ${t.reason}`,
      meta: overdue ? 'Overdue' : shortDate(t.requestedAt || t.createdAt),
      // An unanswered transfer past its acknowledgement window is a patient
      // nobody has taken responsibility for, so it outranks ordinary warnings.
      tone: overdue ? ('danger' as const) : ('warning' as const),
      href: `/patients/${t.patientId}?tab=referrals`,
      actionLabel: 'Review transfer',
      actionHref: `/patients/${t.patientId}?tab=referrals`,
    };
  });

  const outstandingItems: OutstandingItem[] = [
    {
      label: 'Transfers to accept',
      count: incomingTransfers.length,
      tone: incomingTransfers.some(t => isTransferOverdue(t, now))
        ? ('danger' as const)
        : incomingTransfers.length > 0 ? ('warning' as const) : ('neutral' as const),
      entries: transferEntries,
    },
    // Each document/phone-note entry already opens its patient chart. There is
    // no meaningful cross-patient queue page anymore, so omit the group-level
    // link instead of sending clinicians to the generic patient registry.
    { label: 'Documents to sign', count: signCount, tone: signCount > 0 ? 'warning' as const : 'neutral' as const, entries: documentEntries },
    { label: 'Phone notes', count: phoneNotesInbox.length, tone: phoneNotesInbox.length > 0 ? 'warning' as const : 'neutral' as const, entries: phoneNoteEntries },
    { label: 'Open referrals', count: myOpenReferrals.length, href: '/referrals', entries: referralEntries },
    { label: 'Awaiting labs', count: resumableEncounters.length, tone: resumableEncounters.length > 0 ? 'danger' as const : 'neutral' as const, href: '/lab', entries: labEntries },
    { label: 'Follow-ups due', count: dueFollowUps.length, tone: dueFollowUps.length > 0 ? 'warning' as const : 'neutral' as const, entries: followUpEntries },
  ];

  return {
    patients: [...assignedRows, ...triageAssignedRows, ...unassignedRows],
    appointments: myAppts,
    outstanding: outstandingItems,
  };
}

/**
 * The doctor / clinical officer / clinician / super-admin home view.
 *
 * Extracted out of `DashboardPage` (below) so its hooks stay unconditional:
 * `DashboardPage` is now a pure role switch between this view, `NurseHomeView`
 * and `SuperintendentDashboard`, and each view calls only the hooks its own
 * role's worklist needs. Splitting them out is what keeps a nurse's render
 * from ever calling `useSigningInbox`/`useTransferQueue`/etc. (or vice versa)
 * — no hook in this file runs conditionally on the role branch anymore.
 */
export default function ClinicianHomeView() {
  const { currentUser } = useAuth();
  const { patients } = usePatients();
  // Consultations this clinician paused while waiting on lab/imaging results.
  const { encounters: resumableEncounters } = useResumableEncounters();
  // Documents awaiting signature / co-signature — the "to sign" inbox.
  const { unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes } = useSigningInbox();
  // Open patient phone notes routed to me — callbacks worklist.
  const { notes: phoneNotesInbox } = usePhoneNotesInbox();
  // Referrals — drives the "My Referrals" / "Open referrals" outstanding item.
  const { referrals } = useReferrals();
  // Appointments — drives the schedule board. Check-in is issued from the row
  // itself, not from here; the mutator this used to destructure was unused.
  const { appointments } = useAppointments();
  const { triages } = useTriage();
  // Internal transfers waiting on THIS clinician to accept or reject. Surfaced
  // here because a transfer request only ever shown on the patient's chart is
  // invisible to the person who has to answer it — they have no reason to open
  // a chart that isn't theirs yet.
  const { incoming: incomingTransfers } = useTransferQueue();
  // Community-health follow-ups due (or nearly due) — the "Follow-ups due" rail.
  const { followUpsDue } = useFollowUpsDue();

  // DashboardPage only renders this view once currentUser is loaded and its
  // role has been checked — this guard is purely for TypeScript's benefit
  // (useAuth()'s return type is nullable) and should never actually fire.
  if (!currentUser) return null;

  const worklist = assembleDoctorWorklist({
    patients, triages, currentUser, appointments,
    unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes,
    phoneNotesInbox, referrals, resumableEncounters, incomingTransfers,
    followUpsDue,
  });

  return (
    <main className="page-container page-enter">
      <EhrClinicalDashboard
        clinicianName={currentUser.name || 'clinician'}
        patients={worklist.patients}
        appointments={worklist.appointments}
        outstanding={worklist.outstanding}
      />
    </main>
  );
}
