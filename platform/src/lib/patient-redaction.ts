/**
 * Patient document hygiene shared by the patient routes and the service layer.
 *
 * Two jobs, both pure (no DB, safe in browser and server bundles):
 *
 *  1. `redactPatient` -- what may leave the server. The portal credential hash
 *     and the activation-token hash are secrets; they are never serialised,
 *     only reported as booleans.
 *  2. `stripProtectedPatientFields` -- what a caller may NOT write through a
 *     generic update. Portal credential fields are written only by
 *     modules/identity/services/patient-portal-enrolment.ts and by
 *     createPatient's portalInvite (both call db.put directly), so no generic
 *     update path may carry them.
 */

/** Every portal credential / enrolment field. Never writable via a generic update. */
export const PATIENT_PORTAL_FIELDS = [
  'portalUsername',
  'portalPasswordHash',
  'portalPasswordSetAt',
  'portalCredentialEpoch',
  'portalInviteTokenHash',
  'portalInviteExpiresAt',
  'portalDisabledAt',
  'portalEnabledAt',
  'portalEnabledBy',
  'portalLastLoginAt',
] as const;

/** Identity / ownership fields that must not move through a generic update. */
export const PATIENT_IMMUTABLE_FIELDS = [
  '_id', '_rev', 'type', 'createdAt', 'createdBy',
  'hospitalNumber', 'registrationDate',
  // Cross-org visibility grant read by filterByScope (referrals/transfers
  // only). A patient never carries it, and writing it would expose the
  // patient to another organisation.
  'toOrgId',
  // The duplicate link is written only by markPatientDuplicate /
  // clearPatientDuplicate, which check org, scope and chains. A generic
  // update must not set or clear it.
  'duplicateOf', 'duplicateMarkedAt', 'duplicateMarkedBy', 'duplicateMarkedByName', 'duplicateReason',
] as const;

/** Additional fields refused on the HTTP surface (the service lets internal flows re-home a patient). */
export const PATIENT_ROUTE_PROTECTED_FIELDS = [
  'orgId', 'countryId', 'registrationHospital', 'geocodeId',
  // Sibling routing fields filterByScope reads for facility matching; a
  // patient document must not be able to steer its own visibility.
  'toHospitalId', 'fromHospitalId', 'recipientHospitalId', 'facilityId',
] as const;

type Rec = Record<string, unknown>;

/** Remove portal + immutable fields (and optionally route-protected ones) from a patch. Returns a copy. */
export function stripProtectedPatientFields<T extends Rec>(
  data: T,
  opts: { route?: boolean } = {},
): Partial<T> {
  const out: Rec = { ...data };
  for (const k of PATIENT_PORTAL_FIELDS) delete out[k];
  for (const k of PATIENT_IMMUTABLE_FIELDS) delete out[k];
  if (opts.route) for (const k of PATIENT_ROUTE_PROTECTED_FIELDS) delete out[k];
  // Defensive: any other portal* key a future field adds is also refused.
  for (const k of Object.keys(out)) if (k.startsWith('portal')) delete out[k];
  return out as Partial<T>;
}

/** Copy of a patient safe to return over HTTP: no hashes, only booleans. */
export function redactPatient<T extends object>(patient: T): Omit<T, 'portalPasswordHash' | 'portalInviteTokenHash'> & {
  portalHasPassword: boolean;
  portalInvitePending: boolean;
} {
  const p = { ...(patient as Rec) };
  const hasPassword = typeof p.portalPasswordHash === 'string' && p.portalPasswordHash.length > 0;
  const invitePending = typeof p.portalInviteTokenHash === 'string' && p.portalInviteTokenHash.length > 0;
  delete p.portalPasswordHash;
  delete p.portalInviteTokenHash;
  delete p.portalCredentialEpoch;
  return { ...(p as Rec), portalHasPassword: hasPassword, portalInvitePending: invitePending } as never;
}

export function redactPatients<T extends object>(patients: readonly T[]): ReturnType<typeof redactPatient<T>>[] {
  return patients.map((p) => redactPatient(p));
}
