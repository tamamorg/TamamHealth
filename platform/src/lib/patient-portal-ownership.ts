/**
 * Which organisation and facility a patient's portal write belongs to.
 *
 * Staff write from a signed-in session that carries their organisation, so
 * every document they create is stamped with it. A patient's session carries
 * only the patient — and the three portal routes that write (messages,
 * appointment requests, payments) therefore saved documents with no `orgId`
 * at all. Tenant filtering (`filterByScope`) rejects a document with no
 * organisation, and replication to a clinic's devices is per-organisation, so
 * those documents were accepted, acknowledged to the patient, and then visible
 * to nobody: the message unread, the appointment request never triaged, the
 * payment never reviewed.
 *
 * Ownership is read from the patient's own record and never from the request
 * body. A patient must not be able to file a document into an organisation by
 * naming it — not even by naming one of its facilities.
 */
import type { HospitalDoc, PatientDoc } from './db-types';

export interface PortalOwnership {
  orgId?: string;
  /** The facility the write belongs to: the one asked for when allowed, else the patient's own. */
  facilityId?: string;
  /** The patient record, when it could be read — callers reuse it rather than fetch twice. */
  patient?: PatientDoc | null;
  /**
   * Set when the request named a facility that exists but belongs to a
   * different organisation from the patient. The write must be refused: the
   * portal is one organisation's door, and a document stamped with another
   * organisation's id replicates straight into that organisation's queues.
   */
  foreignFacility?: boolean;
}

/**
 * Resolve ownership for a write by `patientId`, optionally about a specific
 * facility (the one an appointment is requested at, say).
 *
 * The organisation is ALWAYS the patient's own. A requested facility is
 * honoured only when it is a real facility in that same organisation; one the
 * server does not know is ignored in favour of the patient's registration
 * facility, and one in another organisation is flagged for the caller to
 * refuse.
 *
 * A lookup that fails returns what it could find. Callers must not save a
 * document with no `orgId` — see `missingOwnership`.
 */
export async function resolvePortalOwnership(
  patientId: string,
  requestedFacilityId?: string,
): Promise<PortalOwnership> {
  let patient: PatientDoc | null = null;
  try {
    const { getPatientById } = await import('./services/patient-service');
    patient = await getPatientById(patientId);
  } catch { /* fall through with what we have */ }

  const own: PortalOwnership = {
    orgId: patient?.orgId,
    facilityId: patient?.registrationHospital || undefined,
    patient,
  };

  const requested = (requestedFacilityId || '').trim();
  if (!requested || requested === own.facilityId) return own;

  const facility = await readFacility(requested);
  if (!facility) return own;
  if (!own.orgId || facility.orgId !== own.orgId) return { ...own, foreignFacility: true };
  return { ...own, facilityId: facility._id };
}

/**
 * True when a write has no organisation to belong to and must not be saved:
 * it would be acknowledged to the patient and then visible to nobody.
 */
export function missingOwnership(ownership: PortalOwnership): boolean {
  return !ownership.orgId;
}

async function readFacility(id: string): Promise<HospitalDoc | null> {
  try {
    const { hospitalsDB } = await import('./db');
    const doc = await hospitalsDB().get(id) as HospitalDoc;
    return doc?.type === 'hospital' ? doc : null;
  } catch {
    return null;
  }
}
