/**
 * Patient-portal credentials are the server's to write.
 *
 * A patient document carries the fields the portal signs a patient in with:
 * the username, the password hash, the outstanding activation-token hash, and
 * whether the account is suspended. The document itself is writable by every
 * role that registers or edits patients, from any device. Without this rule a
 * nurse's (or a stolen) device could write the hash of a code it chose onto an
 * existing patient, let it replicate, redeem it at the unauthenticated
 * activation endpoint, and hold that patient's portal account from anywhere.
 *
 * The rule, applied by the sync gateway to every patient write:
 *
 *   - once the server holds a patient, its `portal*` fields are whatever the
 *     SERVER holds. A device's copy of them is ignored, in either direction —
 *     it cannot set, change, clear or un-suspend. Legitimate changes all go
 *     through the API (`/api/patients/portal-access`, activation, login),
 *     which writes as the server.
 *   - a patient the server has never seen may arrive with an invitation, but
 *     only from a role allowed to register patients, and never with a password
 *     or a suspension state: registration can issue an invitation, nothing
 *     more. The invitation has to be the shape the desk issues: a SHA-256
 *     hash, a normalised username, and an expiry no further out than a slip
 *     lasts.
 *   - "never seen" means never, anywhere. A patient the server once held and
 *     has since deleted, or holds under another organization, is not new: a
 *     device that deletes a patient and writes them back would otherwise be
 *     registering them again, invitation and all. The gateway passes
 *     `SERVER_HELD_BEFORE` for those, and they arrive with no portal access.
 *
 * It rewrites rather than refuses, on purpose. A device that edits a
 * patient's phone number while holding a copy from before the patient
 * activated is not attacking anything; refusing its write would lose the
 * edit. Its stale portal fields are simply replaced with the server's.
 *
 * The CouchDB validator cannot do this: it cannot rewrite a document, and a
 * replicated write can invent the revision it claims to replace.
 */
import type { UserRole } from '../db-types';
import { DOC_WRITE_ROLES } from './write-permissions';
import { PORTAL_INVITE_TTL_HOURS, normalisePortalUsername } from '@/modules/identity/provisioning/portal-invite';

/** Roles that may issue or re-issue portal access from a chart. Shared with the enrol API. */
export const PORTAL_ENROL_ROLES: readonly UserRole[] = [
  'super_admin', 'org_admin', 'front_desk', 'central_registration_clerk',
  'clinic_clerk', 'hrio', 'records_hmis_officer', 'medical_superintendent',
  'hospital_manager',
];

/**
 * Whether a registration by `role` may carry a portal invitation.
 *
 * Every role that can register a patient, which is wider than the enrol list
 * above. The two answer different questions. Re-issuing access to a patient
 * who already has a record hands somebody a way into that record, so it stays
 * with the desk and records roles. Registering a patient creates the record
 * and hands over its slip in the same act, by the same person; in a small
 * facility that person is a nurse or a clinical officer, and refusing their
 * invitation printed a slip whose code never activated, with nothing to tell
 * anyone why.
 *
 * The registration form asks this before it offers the account, so the form
 * and the gateway cannot disagree.
 */
export function canIssuePortalInvite(role: string | undefined): boolean {
  return Boolean(role) && (DOC_WRITE_ROLES.patient as readonly string[]).includes(role as string);
}

/** What an invitation issued at registration consists of. */
const INVITATION_FIELDS: readonly string[] = [
  'portalUsername', 'portalEnabledAt', 'portalEnabledBy',
  'portalInviteTokenHash', 'portalInviteExpiresAt',
];

type Doc = Record<string, unknown>;
const isPortalField = (key: string) => key.startsWith('portal');

function portalFieldsOf(doc: Doc): Doc {
  const out: Doc = {};
  for (const key of Object.keys(doc)) if (isPortalField(key)) out[key] = doc[key];
  return out;
}

/**
 * What the gateway passes as `current` for a patient the server does not hold
 * live but has held before: a tombstone in this organization's database, or
 * any revision in the server's own register.
 */
export const SERVER_HELD_BEFORE: Doc = Object.freeze({ _deleted: true });

/** A device clock may run ahead of the server's; an expiry this far past a slip's lifetime is not one. */
const EXPIRY_SKEW_MS = 24 * 3_600_000;
const TOKEN_HASH = /^[0-9a-f]{64}$/;

/**
 * The invitation a registration may carry, or nothing if it is not one.
 *
 * Copying whatever was sent let a device choose an expiry in the year 9999, or
 * a username nobody could type. An invitation that is not the desk's shape is
 * dropped whole; one that only outlives a slip is cut back to a slip's life.
 */
function invitationFrom(sent: Doc, now: Date): Doc {
  const { portalUsername: username, portalInviteTokenHash: hash, portalInviteExpiresAt: expiresAt } = sent;
  if (typeof username !== 'string' || username.length < 3 || normalisePortalUsername(username) !== username) return {};
  if (typeof hash !== 'string' || !TOKEN_HASH.test(hash)) return {};
  const expires = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
  if (Number.isNaN(expires)) return {};

  const out: Doc = {};
  for (const field of INVITATION_FIELDS) if (typeof sent[field] === 'string') out[field] = sent[field];
  const latest = now.getTime() + PORTAL_INVITE_TTL_HOURS * 3_600_000;
  if (expires > latest + EXPIRY_SKEW_MS) out.portalInviteExpiresAt = new Date(latest).toISOString();
  return out;
}

/**
 * The patient document as the server will store it, and whether that differs
 * from what the device sent. `current` is the server's live copy; null when
 * the server has never held this patient; `SERVER_HELD_BEFORE` (or any
 * tombstone) when it has, but holds no live copy to take the fields from.
 */
export function applyPortalCredentialAuthority(
  next: Doc,
  current: Doc | null | undefined,
  role: string | undefined,
  now: Date = new Date(),
): { doc: Doc; changed: boolean } {
  if (next.type !== 'patient' || next._deleted === true) return { doc: next, changed: false };
  const sent = portalFieldsOf(next);

  let authoritative: Doc;
  if (current && current._deleted !== true) {
    authoritative = portalFieldsOf(current);
  } else if (!current && canIssuePortalInvite(role)) {
    authoritative = invitationFrom(sent, now);
  } else {
    authoritative = {};
  }

  if (JSON.stringify(sortKeys(sent)) === JSON.stringify(sortKeys(authoritative))) {
    return { doc: next, changed: false };
  }
  const doc: Doc = {};
  for (const key of Object.keys(next)) if (!isPortalField(key)) doc[key] = next[key];
  return { doc: { ...doc, ...authoritative }, changed: true };
}

function sortKeys(value: Doc): Doc {
  const out: Doc = {};
  for (const key of Object.keys(value).sort()) out[key] = value[key];
  return out;
}
