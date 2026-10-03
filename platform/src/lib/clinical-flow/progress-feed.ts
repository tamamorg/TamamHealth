/**
 * Patient-progress feed — "who moved where, just now".
 *
 * The clinician dashboard has "Awaiting review": a short list of things that
 * need this person's attention. Every other station has the same need but a
 * different question. A nurse wants to know who came back from the lab; the
 * pharmacy wants to know whose script was just cleared; the front desk wants
 * to know who has finished and can be checked out. None of them had anywhere
 * to see it, so the answer was "walk over and ask".
 *
 * This module turns the documents that already exist into a single stream of
 * progress events, and each role reads the slice it cares about.
 *
 * ## Honesty about timestamps
 *
 * A document records its CURRENT lifecycle stage, not a log of when each stage
 * was reached. Only a few stages have their own stamp (`dispensedAt`,
 * `triagedAt`, `completedAt`). For the rest, the best available time is the
 * document's `updatedAt` — which is when it last changed, and is usually but
 * not always when it reached the stage now shown.
 *
 * So every event carries `approximate`. When it is true the UI says "updated",
 * not "dispensed 4m ago". Presenting a last-modified time as a precise clinical
 * event time is the kind of small lie that gets believed and then relied on —
 * it would let someone say "the drug was dispensed at 14:32" from a record that
 * never claimed any such thing.
 *
 * Pure and dependency-free so it can be tested without a database.
 */

import type { LabOrderStatus, PrescriptionStatus } from './order-lifecycles';
import type { UserRole } from '../db-types';

export type ProgressEventKind =
  | 'triaged'
  | 'specimen_collected'
  | 'lab_resulted'
  | 'lab_reviewed'
  | 'prescribed'
  | 'cleared_for_dispensing'
  | 'dispensed'
  | 'stockout';

export interface ProgressEvent {
  id: string;
  kind: ProgressEventKind;
  patientId: string;
  patientName: string;
  /** Past-tense phrase describing what happened, e.g. "dispensed". */
  label: string;
  /** Optional detail — the test name, the drug. */
  detail?: string;
  /** ISO timestamp this event is dated from. */
  at: string;
  /** Where clicking the row goes. */
  href: string;
  /**
   * True when `at` is the document's last-modified time rather than a stamp
   * belonging to this specific stage. The UI must soften its wording.
   */
  approximate: boolean;
}

/** Minimal shapes — this module reads a few fields, not whole documents. */
interface TriageLike {
  _id: string; patientId: string; patientName: string;
  triagedAt?: string; updatedAt?: string; createdAt?: string;
}
interface LabLike {
  _id: string; patientId: string; patientName: string; testName?: string;
  orderStatus?: LabOrderStatus; status?: string;
  completedAt?: string; updatedAt?: string; createdAt?: string;
}
interface RxLike {
  _id: string; patientId: string; patientName: string; medicationName?: string;
  orderStatus?: PrescriptionStatus; status?: string;
  /** 'external' = a script the patient fills at an outside pharmacy. */
  fulfilment?: string;
  dispensedAt?: string; updatedAt?: string; createdAt?: string;
}

/** First non-empty timestamp, or '' when the document carries none. */
function pick(...vals: (string | undefined)[]): string {
  for (const v of vals) if (v) return v;
  return '';
}

/**
 * Build the full event stream. Callers filter by kind and slice.
 *
 * `sinceMs` bounds the window — a progress feed showing yesterday's movements
 * is noise, and the whole point is "just now".
 */
export function buildProgressFeed(
  input: { triages?: TriageLike[]; labs?: LabLike[]; prescriptions?: RxLike[] },
  opts: { nowMs: number; windowMs?: number },
): ProgressEvent[] {
  const windowMs = opts.windowMs ?? 12 * 60 * 60 * 1000;
  const cutoff = opts.nowMs - windowMs;
  const out: ProgressEvent[] = [];

  const within = (iso: string) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    // A future timestamp means a clock-skewed device, not a future event.
    // Keep it rather than dropping it — hiding a record because a tablet's
    // clock is wrong is worse than showing it slightly out of order.
    return !Number.isNaN(t) && t >= cutoff;
  };

  for (const d of input.triages ?? []) {
    const at = pick(d.triagedAt, d.updatedAt, d.createdAt);
    if (!within(at)) continue;
    out.push({
      id: `triage-${d._id}`,
      kind: 'triaged',
      patientId: d.patientId,
      patientName: d.patientName,
      label: 'triaged',
      at,
      href: `/patients/${d.patientId}?tab=vitals`,
      // triagedAt is a real event stamp, so this one is exact.
      approximate: !d.triagedAt,
    });
  }

  for (const d of input.labs ?? []) {
    const stage = d.orderStatus;
    let kind: ProgressEventKind | null = null;
    let label = '';
    if (stage === 'specimen_collected') { kind = 'specimen_collected'; label = 'specimen collected'; }
    else if (stage === 'resulted') { kind = 'lab_resulted'; label = 'lab result ready'; }
    else if (stage === 'reviewed_by_clinician' || stage === 'acted_upon') { kind = 'lab_reviewed'; label = 'result reviewed'; }
    // Orders predating the granular lifecycle carry only the coarse `status`.
    // Without this the lab's own feed is empty on every existing record —
    // `orderStatus` is optional and most stored results do not have it, so
    // reading it alone makes the feature dead on arrival for real data.
    else if (!stage && d.status === 'completed') { kind = 'lab_resulted'; label = 'lab result ready'; }
    if (!kind) continue;

    // `completedAt` belongs to the resulted stage specifically; for the others
    // only updatedAt is available.
    const exact = kind === 'lab_resulted' ? d.completedAt : undefined;
    const at = pick(exact, d.updatedAt, d.createdAt);
    if (!within(at)) continue;

    out.push({
      id: `lab-${d._id}-${kind}`,
      kind,
      patientId: d.patientId,
      patientName: d.patientName,
      label,
      detail: d.testName,
      at,
      href: `/patients/${d.patientId}?tab=labs&focus=${encodeURIComponent(d._id)}`,
      approximate: !exact,
    });
  }

  for (const d of input.prescriptions ?? []) {
    // An outside-pharmacy script never moves through this facility's
    // dispensing stages; it is not "received" by anyone here.
    if (d.fulfilment === 'external') continue;
    const stage = d.orderStatus;
    let kind: ProgressEventKind | null = null;
    let label = '';
    if (stage === 'prescribed' || stage === 'received_in_pharmacy_queue') { kind = 'prescribed'; label = 'prescription received'; }
    else if (stage === 'cleared_for_dispensing') { kind = 'cleared_for_dispensing'; label = 'cleared for dispensing'; }
    else if (stage === 'dispensed' || stage === 'counseled' || stage === 'complete') { kind = 'dispensed'; label = 'dispensed'; }
    else if (stage === 'stockout_partial_referred') { kind = 'stockout'; label = 'stockout — referred'; }
    // Older prescriptions predate `orderStatus` and only carry the coarse
    // field. Treat an explicit `dispensed` there as a dispense rather than
    // dropping the record, or the feed goes blank on historical data.
    else if (!stage && d.status === 'dispensed') { kind = 'dispensed'; label = 'dispensed'; }
    if (!kind) continue;

    const exact = kind === 'dispensed' ? d.dispensedAt : undefined;
    const at = pick(exact, d.updatedAt, d.createdAt);
    if (!within(at)) continue;

    out.push({
      id: `rx-${d._id}-${kind}`,
      kind,
      patientId: d.patientId,
      patientName: d.patientName,
      label,
      detail: d.medicationName,
      at,
      href: `/patients/${d.patientId}?tab=medications`,
      approximate: !exact,
    });
  }

  // Newest first — a progress feed is read from the top.
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Per-role view of the feed.
 *
 * The title is the role's own question, not a generic "Activity". A nurse
 * scanning a rail should not have to work out what the card is for.
 */
export interface ProgressFeedConfig {
  title: string;
  kinds: readonly ProgressEventKind[];
}

/**
 * Typed against `UserRole` deliberately. The first version keyed this by
 * `string` and shipped `lab_technician` — the real role is `lab_tech` — so the
 * lab's own card silently never rendered. A wrong key now fails to compile
 * instead of failing quietly on one dashboard.
 *
 * Governance and aggregate roles are absent on purpose: `government`,
 * `county_health_director` and the admin roles read geographic rollups, and a
 * named-patient feed there would cross the scope boundary those dashboards
 * exist to respect.
 */
export const PROGRESS_FEED_BY_ROLE: Readonly<Partial<Record<UserRole, ProgressFeedConfig>>> = {
  // Clinicians watch the flow from the receiving end: who has been triaged
  // toward them, whose results are back, whose treatment completed at the
  // pharmacy. (Originally omitted on the theory that "Awaiting review"
  // covered it — it covers results only, not patient movement.)
  doctor: { title: 'Patient flow', kinds: ['triaged', 'lab_resulted', 'dispensed'] },
  clinical_officer: { title: 'Patient flow', kinds: ['triaged', 'lab_resulted', 'dispensed'] },
  clinician: { title: 'Patient flow', kinds: ['triaged', 'lab_resulted', 'dispensed'] },
  medical_superintendent: { title: 'Patient flow', kinds: ['triaged', 'lab_resulted', 'dispensed'] },

  // Nurses hand patients on and receive them back — they care about movement
  // through triage and about results landing for someone they are watching.
  nurse: { title: 'Patient progress', kinds: ['triaged', 'lab_resulted', 'dispensed'] },
  triage_nurse: { title: 'Patient progress', kinds: ['triaged', 'lab_resulted', 'dispensed'] },
  rooming_nurse: { title: 'Patient progress', kinds: ['triaged', 'lab_resulted', 'dispensed'] },

  // Midwives run their own clinical station and hand patients on like any
  // other clinician.
  midwife: { title: 'Patient progress', kinds: ['triaged', 'lab_resulted', 'dispensed'] },

  // The lab's own pipeline, from specimen in to result acted on.
  lab_tech: { title: 'Specimens moving', kinds: ['specimen_collected', 'lab_resulted', 'lab_reviewed'] },

  // The pharmacy queue, front to back.
  pharmacist: { title: 'Scripts moving', kinds: ['prescribed', 'cleared_for_dispensing', 'dispensed', 'stockout'] },

  // The front desk needs to know who has finished, so it can close them out.
  front_desk: { title: 'Patient flow', kinds: ['triaged', 'dispensed'] },
  central_registration_clerk: { title: 'Patient flow', kinds: ['triaged', 'dispensed'] },
  clinic_clerk: { title: 'Patient flow', kinds: ['triaged', 'dispensed'] },

  radiologist: { title: 'Imaging moving', kinds: ['specimen_collected', 'lab_resulted'] },
  nutritionist: { title: 'Patient progress', kinds: ['triaged', 'lab_resulted'] },
  data_entry_clerk: { title: 'Recent activity', kinds: ['triaged', 'lab_resulted', 'dispensed'] },
};

export function progressFeedFor(role: string | undefined): ProgressFeedConfig | null {
  if (!role) return null;
  return PROGRESS_FEED_BY_ROLE[role as UserRole] ?? null;
}

/** Compact relative time: "just now", "12m", "3h". */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((nowMs - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
