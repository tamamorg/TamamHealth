/**
 * Shared context for the portal's booking routes (reasons, slots, request).
 *
 * Everything here is derived from the signed-in patient's own record, never
 * from the request: the organisation and facility come from
 * `resolvePortalOwnership`, and the patient class from their appointment
 * history. The client only ever chooses a visit reason and a slot.
 */
import type { AppointmentDoc, FacilityLevel } from './db-types';
import type { PatientClass, VisitReasonDoc } from './db-types-booking';

/** Statuses that mean the patient has actually been seen here before. */
const SEEN_STATUSES: ReadonlyArray<AppointmentDoc['status']> = ['checked_in', 'in_progress', 'completed'];

export interface PortalBookingContext {
  orgId: string;
  facilityId: string;
  facilityName: string;
  facilityLevel: FacilityLevel;
  patientClass: PatientClass;
  patientPhone?: string;
}

/**
 * `'returning'` if the patient has been seen before (a checked-in, roomed or
 * completed appointment), else `'new'`.
 */
export function classifyPatient(
  appointments: Pick<AppointmentDoc, 'status'>[],
  patient?: { lastVisitDate?: string } | null,
): PatientClass {
  // A walk-in seen without ever booking has no appointment history but does
  // have a last visit on their record — they are returning, not new.
  if (patient?.lastVisitDate) return 'returning';
  return appointments.some(a => SEEN_STATUSES.includes(a.status)) ? 'returning' : 'new';
}

/** Resolve org, facility and patient class for a portal session, or null if the patient has no home. */
export async function resolvePortalBookingContext(patientId: string): Promise<PortalBookingContext | null> {
  const { resolvePortalOwnership, missingOwnership } = await import('./patient-portal-ownership');
  const ownership = await resolvePortalOwnership(patientId);
  if (missingOwnership(ownership) || !ownership.facilityId) return null;

  const { getAppointmentsByPatient } = await import('./services/appointment-service');
  const appointments = await getAppointmentsByPatient(patientId).catch(() => [] as AppointmentDoc[]);

  let facilityName = '';
  let facilityLevel: FacilityLevel = 'county';
  try {
    const { getHospitalById } = await import('./services/hospital-service');
    const hospital = await getHospitalById(ownership.facilityId);
    facilityName = hospital?.name ?? '';
    facilityLevel = hospital?.facilityLevel ?? 'county';
  } catch { /* the id alone is enough to book */ }

  return {
    orgId: ownership.orgId as string,
    facilityId: ownership.facilityId,
    facilityName,
    facilityLevel,
    patientClass: classifyPatient(appointments, ownership.patient),
    patientPhone: ownership.patient?.phone || undefined,
  };
}

/**
 * The visit reason with this id, if it is one the patient's facility offers
 * (active, and in their organisation). Looks through the facility's menu
 * rather than the raw table so built-in defaults, which are computed and never
 * stored, resolve too.
 */
export async function findOfferedReason(
  ctx: Pick<PortalBookingContext, 'orgId' | 'facilityId'>,
  reasonId: string,
): Promise<VisitReasonDoc | null> {
  const { getVisitReasonsForFacility } = await import('./services/visit-reason-service');
  const menu = await getVisitReasonsForFacility(ctx.facilityId, ctx.orgId);
  return menu.find(r => r._id === reasonId && r.isActive) ?? null;
}

/**
 * The clinicians a portal patient may be booked with at this facility: the
 * same rule as the desk's provider list (BookAppointmentModal) — an active
 * doctor or clinical officer whose own facility is this one. Published hours
 * are not authority to assign a clinician; without this the portal offered a
 * provider the desk could neither see nor assign.
 */
const PROVIDER_CACHE_MS = 60_000;
const providerCache = new Map<string, { at: number; ids: Set<string> }>();

export async function bookableProviderIds(facilityId: string): Promise<Set<string>> {
  // Cached per facility for a minute: every slot read and request needs it,
  // and reading the whole users table per call is load the shared CouchDB
  // does not need. A staff change reaches the portal within the minute.
  const hit = providerCache.get(facilityId);
  if (hit && Date.now() - hit.at < PROVIDER_CACHE_MS) return hit.ids;
  const ids = await loadBookableProviderIds(facilityId);
  providerCache.set(facilityId, { at: Date.now(), ids });
  return ids;
}

/** Test seam: drop the per-facility provider cache. */
export function clearBookableProviderCache(): void {
  providerCache.clear();
}

async function loadBookableProviderIds(facilityId: string): Promise<Set<string>> {
  const { getAllUsersUnscoped } = await import('@/modules/identity/services/user-service');
  const { canAssignStaffAtFacility } = await import('./care-team-permissions');
  const users = await getAllUsersUnscoped();
  return new Set(users
    .filter(u => (u.role === 'doctor' || u.role === 'clinical_officer')
      && u.isActive !== false
      && canAssignStaffAtFacility(facilityId, u.hospitalId))
    .map(u => u._id));
}
