/**
 * Capability model for internal patient transfers.
 *
 * Transfers move accountability for a patient, so they are gated more tightly
 * than ordinary chart edits. The rules are expressed as capabilities rather
 * than role checks scattered through the service and the route, so there is one
 * place to read when asking "who can force a transfer?" — and so the API layer
 * and the UI answer that question identically instead of drifting.
 *
 * Two things are deliberately separate:
 *   - CAPABILITY  — what a role may ever do (`ROLE_CAPABILITIES` below).
 *   - RELATIONSHIP — whether this particular user stands in the right relation
 *     to this particular transfer (are they on the sending team? the receiving
 *     one?). Capability alone is never sufficient; see `canAcceptTransfer`.
 */
import type { UserRole, PatientTransferDoc, PatientDoc } from '../db-types';
import type { AuthPayload } from '@/modules/identity';
export type TransferCapability =
  /** Raise a transfer request for a patient you are currently involved in. */
  | 'patient.transfer.request'
  /** Decide (accept/reject) a transfer addressed to you or your team. */
  | 'patient.transfer.accept'
  /** Move ownership immediately without the receiver accepting. Admin only. */
  | 'patient.transfer.force'
  /** Withdraw a pending request. */
  | 'patient.transfer.cancel'
  /** Read the transfer history on a chart. */
  | 'patient.transfer.view_history'
  /** Send a transfer whose destination is a different organisation. */
  | 'patient.transfer.cross_org';

/**
 * Role → capabilities.
 *
 * Deliberate omissions, so the gaps read as decisions rather than oversights:
 *   - `front_desk`, `cashier`, `data_entry_clerk` and the clerk workflow roles
 *     can view history (they field "who is looking after X?" calls) but cannot
 *     move clinical responsibility.
 *   - `nurse` / `midwife` / `triage_nurse` / `rooming_nurse` can request and
 *     cancel — the nurse→doctor hand-off is the commonest transfer in this
 *     platform — but cannot accept on a doctor's behalf.
 *   - Only `super_admin`, `org_admin` and `medical_superintendent` may force,
 *     and only those three plus `hospital_manager` may send cross-org.
 *   - `government` / `county_health_director` are read-only observers here:
 *     national oversight roles do not run facility care assignment.
 */
const ROLE_CAPABILITIES: Partial<Record<UserRole, TransferCapability[]>> = {
  super_admin: [
    'patient.transfer.request', 'patient.transfer.accept', 'patient.transfer.force',
    'patient.transfer.cancel', 'patient.transfer.view_history', 'patient.transfer.cross_org',
  ],
  org_admin: [
    'patient.transfer.request', 'patient.transfer.accept', 'patient.transfer.force',
    'patient.transfer.cancel', 'patient.transfer.view_history', 'patient.transfer.cross_org',
  ],
  medical_superintendent: [
    'patient.transfer.request', 'patient.transfer.accept', 'patient.transfer.force',
    'patient.transfer.cancel', 'patient.transfer.view_history', 'patient.transfer.cross_org',
  ],
  hospital_manager: [
    'patient.transfer.request', 'patient.transfer.cancel',
    'patient.transfer.view_history', 'patient.transfer.cross_org',
  ],
  doctor: [
    'patient.transfer.request', 'patient.transfer.accept',
    'patient.transfer.cancel', 'patient.transfer.view_history',
  ],
  clinician: [
    'patient.transfer.request', 'patient.transfer.accept',
    'patient.transfer.cancel', 'patient.transfer.view_history',
  ],
  clinical_officer: [
    'patient.transfer.request', 'patient.transfer.accept',
    'patient.transfer.cancel', 'patient.transfer.view_history',
  ],
  nurse: ['patient.transfer.request', 'patient.transfer.cancel', 'patient.transfer.view_history'],
  midwife: ['patient.transfer.request', 'patient.transfer.cancel', 'patient.transfer.view_history'],
  triage_nurse: ['patient.transfer.request', 'patient.transfer.cancel', 'patient.transfer.view_history'],
  rooming_nurse: ['patient.transfer.request', 'patient.transfer.cancel', 'patient.transfer.view_history'],
  nutritionist: ['patient.transfer.request', 'patient.transfer.view_history'],
  radiologist: ['patient.transfer.view_history'],
  lab_tech: ['patient.transfer.view_history'],
  pharmacist: ['patient.transfer.view_history'],
  front_desk: ['patient.transfer.view_history'],
  cashier: ['patient.transfer.view_history'],
  medical_biller: ['patient.transfer.view_history'],
  data_entry_clerk: ['patient.transfer.view_history'],
  hrio: ['patient.transfer.view_history'],
  records_hmis_officer: ['patient.transfer.view_history'],
  central_registration_clerk: ['patient.transfer.view_history'],
  clinic_clerk: ['patient.transfer.view_history'],
  government: ['patient.transfer.view_history'],
  county_health_director: ['patient.transfer.view_history'],
};

/** Roles allowed to accept on behalf of a whole department/facility rather
 *  than only when named personally as the destination provider. */
const TEAM_LEAD_ROLES = new Set<UserRole>([
  'super_admin', 'org_admin', 'medical_superintendent',
]);

export function transferCapabilities(role: UserRole): TransferCapability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function hasTransferCapability(role: UserRole, cap: TransferCapability): boolean {
  return transferCapabilities(role).includes(cap);
}

/** Every role that may hold at least one write capability — the allowlist the
 *  API route uses before it even parses the body. */
export const TRANSFER_WRITE_ROLES: UserRole[] = (Object.keys(ROLE_CAPABILITIES) as UserRole[])
  .filter(role => transferCapabilities(role).some(c => c !== 'patient.transfer.view_history'));

export const TRANSFER_READ_ROLES: UserRole[] = (Object.keys(ROLE_CAPABILITIES) as UserRole[])
  .filter(role => hasTransferCapability(role, 'patient.transfer.view_history'));

/** Outcome of a permission check — a boolean plus the reason, so the API can
 *  return something the user can act on instead of a bare 403. */
export interface TransferPermissionResult {
  allowed: boolean;
  reason?: string;
}

const ALLOW: TransferPermissionResult = { allowed: true };
const deny = (reason: string): TransferPermissionResult => ({ allowed: false, reason });

/**
 * True when the user is currently involved in this patient's care: the owning
 * provider, an active care-team member, or the assigning nurse. Admin roles
 * pass by virtue of their remit rather than a care relationship.
 */
export function isOnCareTeam(auth: AuthPayload, patient: PatientDoc): boolean {
  if (TEAM_LEAD_ROLES.has(auth.role)) return true;
  if (patient.assignedDoctor === auth.sub) return true;
  if (patient.assignedBy === auth.sub) return true;
  const now = Date.now();
  return (patient.careTeam ?? []).some(m =>
    m.providerId === auth.sub && (!m.expiresAt || new Date(m.expiresAt).getTime() > now),
  );
}

/**
 * Who may raise a transfer for this patient.
 *
 * The care-relationship requirement is the point of this check: capability says
 * a nurse may transfer patients, it does not say a nurse may transfer *any*
 * patient in the facility. Without the relationship test, any clinician could
 * reassign a colleague's patient out from under them.
 */
export function canRequestTransfer(
  auth: AuthPayload,
  patient: PatientDoc,
  opts: { crossOrg?: boolean } = {},
): TransferPermissionResult {
  if (!hasTransferCapability(auth.role, 'patient.transfer.request')) {
    return deny('Your role cannot request patient transfers.');
  }
  if (!isOnCareTeam(auth, patient)) {
    return deny('Only the current care team can transfer this patient.');
  }
  if (opts.crossOrg && !hasTransferCapability(auth.role, 'patient.transfer.cross_org')) {
    return deny('Transfers to another organisation need administrator approval.');
  }
  return ALLOW;
}

/**
 * Who may accept or reject a pending transfer.
 *
 * A transfer addressed to a named provider is theirs to answer. One addressed
 * to a department or facility can be answered by anyone with accept capability
 * working in that destination, or by a team lead. Notably the requester can
 * never accept their own request — self-acceptance would make the whole
 * request/accept workflow decorative.
 */
export function canDecideTransfer(
  auth: AuthPayload,
  transfer: PatientTransferDoc,
): TransferPermissionResult {
  if (!hasTransferCapability(auth.role, 'patient.transfer.accept')) {
    return deny('Your role cannot accept patient transfers.');
  }
  if (transfer.status !== 'requested') {
    return deny(`This transfer is ${transfer.status} and can no longer be decided.`);
  }
  if (transfer.requestedById && transfer.requestedById === auth.sub
      && !TEAM_LEAD_ROLES.has(auth.role)) {
    return deny('You cannot accept a transfer you requested yourself.');
  }
  if (TEAM_LEAD_ROLES.has(auth.role)) return ALLOW;

  const to = transfer.to;
  if (to.providerId) {
    return to.providerId === auth.sub
      ? ALLOW
      : deny('This transfer is addressed to another provider.');
  }
  // Department/facility-addressed: must actually work at the destination.
  if (to.facilityId && auth.hospitalId && to.facilityId !== auth.hospitalId) {
    return deny('This transfer is addressed to another facility.');
  }
  return ALLOW;
}

/**
 * Who may withdraw a pending transfer. The sender can always withdraw their
 * own; admins can withdraw anyone's (a request left hanging by someone who has
 * gone off shift still needs clearing).
 */
export function canCancelTransfer(
  auth: AuthPayload,
  transfer: PatientTransferDoc,
): TransferPermissionResult {
  if (!hasTransferCapability(auth.role, 'patient.transfer.cancel')) {
    return deny('Your role cannot cancel patient transfers.');
  }
  if (transfer.status !== 'requested' && transfer.status !== 'draft' && transfer.status !== 'accepted') {
    return deny(`This transfer is ${transfer.status} and can no longer be cancelled.`);
  }
  if (TEAM_LEAD_ROLES.has(auth.role)) return ALLOW;
  if (transfer.requestedById === auth.sub || transfer.from.providerId === auth.sub) return ALLOW;
  return deny('Only the requesting clinician or an administrator can cancel this transfer.');
}

/** Users directly involved in the hand-off may update notes, readiness and
 * arrival. This is intentionally narrower than facility-wide write access. */
export function canContributeTransfer(
  auth: AuthPayload,
  transfer: PatientTransferDoc,
): TransferPermissionResult {
  if (TEAM_LEAD_ROLES.has(auth.role)) return ALLOW;
  const canWrite = hasTransferCapability(auth.role, 'patient.transfer.request')
    || hasTransferCapability(auth.role, 'patient.transfer.accept');
  if (!canWrite) return deny('Your role cannot update transfer hand-off details.');
  if (transfer.requestedById === auth.sub || transfer.from.providerId === auth.sub || transfer.to.providerId === auth.sub) {
    return ALLOW;
  }
  if (transfer.to.facilityId && auth.hospitalId === transfer.to.facilityId) return ALLOW;
  return deny('Only the sending or receiving care team can update this transfer.');
}

/**
 * Who may bypass acceptance and move ownership immediately (Option 1, the
 * direct transfer). Restricted to force-capable admin roles precisely because
 * it skips the receiving team's acknowledgement.
 */
export function canForceTransfer(
  auth: AuthPayload,
  patient: PatientDoc,
  opts: { crossOrg?: boolean } = {},
): TransferPermissionResult {
  if (!hasTransferCapability(auth.role, 'patient.transfer.force')) {
    return deny('Only administrators can transfer a patient without acceptance.');
  }
  if (opts.crossOrg && !hasTransferCapability(auth.role, 'patient.transfer.cross_org')) {
    return deny('Transfers to another organisation need administrator approval.');
  }
  // `patient` is accepted so callers can't skip loading it, and so a future
  // sensitive-patient rule has the record to hand.
  void patient;
  return ALLOW;
}
