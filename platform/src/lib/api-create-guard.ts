/**
 * Shared pieces for POST create routes that write a clinical or financial
 * record. Two jobs, both about not trusting the request body:
 *
 *  1. `pickAllowed` keeps ONLY the fields a caller may set. Everything else
 *     (_id, _rev, type, status, result flags, actor/attribution fields,
 *     timestamps, orgId, portal-release flags) is server-owned and is stamped
 *     by the route after the pick.
 *  2. `resolveCreateContext` proves the patient exists inside the caller's
 *     tenant/facility scope (the same `getPatientById` + `filterByScope` rule
 *     /api/medical-records uses) and derives orgId, hospitalId and the patient
 *     display fields from the session and the chart, never from the body.
 *
 * Without (2) a clinician in one organisation could file a result against any
 * patient id and have it replicate to that patient's chart and portal.
 */
import { NextResponse } from 'next/server';
import { forbidden } from '@/modules/identity';
import type { AuthPayload } from '@/modules/identity';
import type { HospitalDoc, PatientDoc } from '@/lib/db-types';

/** Copy only `allowed` keys that the body actually supplies. */
export function pickAllowed(
  body: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  return out;
}

/**
 * Document-identity fields no create body may set. Services spread the input
 * after `_id`/`type`, so a body carrying them would choose the document id
 * (overwriting an existing record) or its type. For routes whose field set is
 * too wide to allow-list in one pass; allow-listing is still preferred.
 */
export const RESERVED_DOC_FIELDS = ['_id', '_rev', '_deleted', '_attachments', 'type', 'createdAt', 'updatedAt', 'isDeleted'] as const;

export function stripReserved(body: Record<string, unknown>): void {
  for (const key of RESERVED_DOC_FIELDS) delete body[key];
}

export function patientDisplayName(patient: Pick<PatientDoc, 'firstName' | 'middleName' | 'surname'>): string {
  return [patient.firstName, patient.middleName, patient.surname]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ');
}

export interface CreateContext {
  patient: PatientDoc;
  /** Always derived: the caller's org, or (org-less platform roles) the patient's. */
  orgId: string | undefined;
  /** The facility the record is filed at; undefined only when none can be resolved. */
  hospitalId: string | undefined;
  /** The resolved facility document, when it could be read. */
  facility: HospitalDoc | null;
}

/**
 * Resolve the patient and facility a create request may write against.
 * Returns a ready-made error response when the caller may not.
 */
export async function resolveCreateContext(
  auth: AuthPayload,
  rawPatientId: unknown,
  requestedHospitalId?: unknown,
): Promise<CreateContext | { response: NextResponse }> {
  const patientId = typeof rawPatientId === 'string' ? rawPatientId.trim() : '';
  if (!patientId) {
    return { response: NextResponse.json({ error: 'patientId is required' }, { status: 400 }) };
  }
  const { getPatientById } = await import('@/lib/services/patient-service');
  const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
  const scope = buildScopeFromAuth(auth);
  const patient = await getPatientById(patientId, scope);
  // Out-of-scope reads as "not found" so the response does not confirm that a
  // patient with that id exists in another tenant.
  if (!patient || filterByScope([patient], scope).length === 0) {
    return { response: NextResponse.json({ error: 'Patient not found' }, { status: 404 }) };
  }

  const orgId = auth.orgId ?? patient.orgId;

  // Facility: the caller's home facility wins. A different one is honoured only
  // when it is inside the caller's facility entitlement or is one of the
  // patient's own facilities, AND it belongs to the same organisation.
  let hospitalId: string | undefined = auth.hospitalId;
  const requested = typeof requestedHospitalId === 'string' && requestedHospitalId ? requestedHospitalId : undefined;
  const { getHospitalById } = await import('@/lib/services/hospital-service');
  if (requested && requested !== auth.hospitalId) {
    const { entitlementFor } = await import('@/lib/sync/facility-entitlements');
    const entitlement = entitlementFor(auth);
    const patientFacilities = [patient.registrationHospital, patient.lastVisitHospital];
    const entitled = entitlement.allFacilities
      || entitlement.facilityIds.includes(requested)
      || patientFacilities.includes(requested);
    if (!entitled) return { response: forbidden('That facility is outside your assignment.') };
    const facility = await getHospitalById(requested);
    if (!facility || !orgId || facility.orgId !== orgId) {
      return { response: forbidden('That facility is outside your organization.') };
    }
    hospitalId = requested;
  } else if (!hospitalId) {
    hospitalId = patient.registrationHospital || undefined;
  }
  let facility: HospitalDoc | null = null;
  if (hospitalId) {
    try { facility = await getHospitalById(hospitalId); } catch { facility = null; }
    // A facility that exists but belongs to another organisation is never ours.
    if (facility && orgId && facility.orgId && facility.orgId !== orgId) facility = null;
  }
  return { patient, orgId, hospitalId, facility };
}

/**
 * Facility for a register entry that has no patient chart to derive it from
 * (births). The caller's home facility wins; a different one is honoured only
 * inside the caller's facility entitlement AND the same organisation.
 */
export async function resolveRegisterFacility(
  auth: AuthPayload,
  requestedFacilityId: unknown,
): Promise<{ hospitalId: string | undefined; facility: HospitalDoc | null } | { response: NextResponse }> {
  const requested = typeof requestedFacilityId === 'string' && requestedFacilityId ? requestedFacilityId : undefined;
  const { getHospitalById } = await import('@/lib/services/hospital-service');
  const hospitalId = auth.hospitalId;
  if (requested && requested !== auth.hospitalId) {
    const { entitlementFor } = await import('@/lib/sync/facility-entitlements');
    const entitlement = entitlementFor(auth);
    if (!(entitlement.allFacilities || entitlement.facilityIds.includes(requested))) {
      return { response: forbidden('That facility is outside your assignment.') };
    }
    const facility = await getHospitalById(requested);
    const crossOrgRole = auth.role === 'super_admin' || auth.role === 'government';
    if (!facility || (!crossOrgRole && (!auth.orgId || facility.orgId !== auth.orgId))) {
      return { response: forbidden('That facility is outside your organization.') };
    }
    return { hospitalId: requested, facility };
  }
  let facility: HospitalDoc | null = null;
  if (hospitalId) {
    try { facility = await getHospitalById(hospitalId); } catch { facility = null; }
    if (facility && auth.orgId && facility.orgId && facility.orgId !== auth.orgId) facility = null;
  }
  return { hospitalId, facility };
}

export function isContext(v: CreateContext | { response: NextResponse }): v is CreateContext {
  return !('response' in v);
}
