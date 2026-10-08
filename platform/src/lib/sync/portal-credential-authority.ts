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
 *     only from a role allowed to enrol, and never with a password or a
 *     suspension state: registration can issue an invitation, nothing more.
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

/** Roles that may issue portal access. One list, shared with the enrol API. */
export const PORTAL_ENROL_ROLES: readonly UserRole[] = [
  'super_admin', 'org_admin', 'front_desk', 'central_registration_clerk',
  'clinic_clerk', 'hrio', 'records_hmis_officer', 'medical_superintendent',
  'hospital_manager',
];

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
 * The patient document as the server will store it, and whether that differs
 * from what the device sent. `current` is the server's copy, or null when it
 * holds none.
 */
export function applyPortalCredentialAuthority(
  next: Doc,
  current: Doc | null | undefined,
  role: string | undefined,
): { doc: Doc; changed: boolean } {
  if (next.type !== 'patient' || next._deleted === true) return { doc: next, changed: false };
  const sent = portalFieldsOf(next);
  const prior = current && current._deleted !== true ? current : null;

  let authoritative: Doc;
  if (prior) {
    authoritative = portalFieldsOf(prior);
  } else if (role && (PORTAL_ENROL_ROLES as readonly string[]).includes(role)) {
    authoritative = {};
    for (const field of INVITATION_FIELDS) if (sent[field] !== undefined) authoritative[field] = sent[field];
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
