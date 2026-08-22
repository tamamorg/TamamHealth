/**
 * Whose notification is it?
 *
 * The feed used to be facility-wide for everyone, so a doctor opened the bell
 * to every future appointment in the hospital and every result that had come
 * back for anybody — five hundred rows, of which a handful were theirs. A feed
 * that large is not a feed: nobody reads it, so the one row that mattered is
 * missed as reliably as if it had never been raised.
 *
 * Two rules keep it honest:
 *
 *   1. Only clinicians get a personal feed. A receptionist, a triage nurse, a
 *      lab tech and a pharmacist are each responsible for the whole floor —
 *      narrowing their feed to "patients assigned to me" would hide the work
 *      their job actually consists of.
 *
 *   2. Critical never filters. An unreviewed critical result reaches every
 *      clinician whether or not their name is on the order, because the cost of
 *      showing it to the wrong doctor is a moment's attention and the cost of
 *      hiding it from the right one is a patient. Ownership decides what is
 *      *routine* enough to leave out.
 */

import type { UserRole } from '@/lib/db-types';

/**
 * The notification sources `useNotifications` aggregates. Defined here rather
 * than in the hook so the relevance map below and the hook share one union
 * without a runtime import cycle.
 */
export type NotificationKind =
  | 'alert' | 'triage' | 'referral' | 'lab'
  | 'appointment' | 'prescription' | 'progress' | 'transfer';

/**
 * Roles that carry a named panel of patients, and so get a feed narrowed to it.
 * Everyone else covers the floor and keeps the facility-wide view.
 */
const PERSONAL_FEED_ROLES: readonly UserRole[] = ['doctor', 'clinical_officer', 'clinician'] as const;

/**
 * Which roles each notification KIND is part of the job for.
 *
 * Rule 1 above narrows a clinician's feed to their own patients; this map is
 * the coarser cut that runs first: whole sources that are simply not a role's
 * work. Before it existed, every pending prescription badged the HR officer,
 * every waiting triage patient badged the cashier, and a super admin's bell
 * read "99+" from the operational churn of every facility on the platform —
 * none of which anyone could act on.
 *
 * 'all' means the kind is either universally safety-relevant (a disease
 * outbreak) or already narrowed to the individual by construction (a transfer
 * addressed to this user). A role absent from a kind's list never receives
 * that source — their settings toggles for it stop mattering, which is the
 * point: relevance is not something each user should have to opt out of.
 */
const KIND_RELEVANT_ROLES: Record<NotificationKind, readonly UserRole[] | 'all'> = {
  // Outbreaks are rare and everyone on the floor should know.
  alert: 'all',
  // Addressed to a specific user (accept this transfer / your transfer was
  // decided) — per-user by construction, so every role keeps it.
  transfer: 'all',
  // The shared waiting room: whoever can pick a patient up, plus the desk
  // that manages the queue.
  triage: ['doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'triage_nurse', 'rooming_nurse', 'front_desk', 'medical_superintendent'],
  // Clinical hand-offs between facilities, plus the records/management roles
  // that steward them.
  referral: ['doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'front_desk', 'records_hmis_officer', 'medical_superintendent', 'hospital_manager'],
  // Results reach the people who order and review them, and the bench that
  // produced them.
  lab: ['doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'lab_tech', 'medical_superintendent'],
  // Providers see their own slots (rule 1); scheduling roles see the floor.
  appointment: ['doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'front_desk', 'clinic_clerk', 'central_registration_clerk', 'data_entry_clerk',
    'medical_superintendent'],
  // The dispensing queue is pharmacy work; nurses keep it for overdue doses.
  prescription: ['pharmacist', 'nurse', 'medical_superintendent'],
  // Care-progress pool items (blocked / unassigned urgent / waiting for
  // provider). Tasks assigned to a specific user bypass this list — see
  // useNotifications — so a task given to a cashier still reaches them.
  progress: ['doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'triage_nurse', 'rooming_nurse', 'medical_superintendent'],
};

/**
 * Is this notification source part of this role's job? A missing/unknown role
 * keeps everything — failing open here only ever adds noise, never hides a
 * notification from someone whose role plainly claims it.
 */
export function isKindRelevantToRole(kind: NotificationKind, role?: UserRole | string): boolean {
  if (!role) return true;
  const relevant = KIND_RELEVANT_ROLES[kind];
  if (relevant === 'all') return true;
  return (relevant as readonly string[]).includes(role);
}

export function hasPersonalFeed(role?: UserRole | string): boolean {
  return !!role && (PERSONAL_FEED_ROLES as readonly string[]).includes(role);
}

export interface FeedViewer {
  _id?: string;
  name?: string;
  username?: string;
  role?: UserRole | string;
}

/** The record's claim on a user: an id where one is stored, else the name. */
export interface RecordOwner {
  /** e.g. AppointmentDoc.providerId. */
  ownerId?: string;
  /** e.g. LabResultDoc.orderedBy, which is free text rather than an id. */
  ownerName?: string;
}

/** Does this record name the viewer as its clinician? */
export function isOwnedByViewer(owner: RecordOwner, viewer: FeedViewer | null | undefined): boolean {
  if (!viewer) return false;
  if (owner.ownerId && viewer._id && owner.ownerId === viewer._id) return true;
  if (!owner.ownerName) return false;
  // Names are compared case-insensitively and trimmed: `orderedBy` is typed by
  // whoever placed the order, so "Dr. Peter Garang Deng " and the account's
  // stored name differ by punctuation more often than by person.
  const recorded = owner.ownerName.trim().toLowerCase();
  return [viewer.name, viewer.username]
    .some(candidate => !!candidate && candidate.trim().toLowerCase() === recorded);
}

/**
 * Should this row reach this viewer? The single test every filtered source
 * calls, so the safety carve-out for critical lives in exactly one place.
 */
export function isForViewer(
  row: RecordOwner & { severity?: 'critical' | 'warning' | 'info' },
  viewer: FeedViewer | null | undefined,
): boolean {
  if (!hasPersonalFeed(viewer?.role)) return true;
  if (row.severity === 'critical') return true;
  return isOwnedByViewer(row, viewer);
}
