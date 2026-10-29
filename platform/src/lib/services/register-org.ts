import { hospitalsDB, birthsDB, deathsDB, ancDB, immunizationsDB, patientsDB, wardDB } from '../db';
import { findByType } from './db-query';
import type { HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { ValidationError } from '../validation';

/**
 * Resolve the organisation a facility register entry (birth, death, ANC visit,
 * immunization) belongs to, or refuse it.
 *
 * A register row without an `orgId` cannot be saved in any useful sense:
 * CouchDB's tenant validator rejects it on push, and `filterByScope` hides it
 * from everyone but super_admin/government on the very device that wrote it.
 * Resolution order: the caller's explicit orgId, the facility's own org, the
 * caller's scope org. A scope org is only a fallback because the facility the
 * entry is filed at is what decides the tenant.
 */
export async function resolveRegisterOrgId(
  input: { orgId?: string; facilityId?: string },
  scope?: Pick<DataScope, 'orgId'> & Partial<Pick<DataScope, 'role'>>,
): Promise<string> {
  if (input.orgId) {
    // An explicit orgId must not let a caller file into another organisation.
    // Only the cross-org roles (the ones filterByScope shows everything to)
    // may name an org other than their own.
    if (scope?.orgId && input.orgId !== scope.orgId && scope.role !== 'super_admin' && scope.role !== 'government') {
      throw new ValidationError({ orgId: 'This record cannot be registered under a different organisation.' });
    }
    return input.orgId;
  }
  if (input.facilityId) {
    try {
      const hosp = await hospitalsDB().get(input.facilityId) as HospitalDoc;
      if (hosp?.orgId) return hosp.orgId;
    } catch {
      // facility not on this device; fall through to the scope
    }
  }
  if (scope?.orgId) return scope.orgId;
  throw new ValidationError({
    facilityId:
      'Select the facility this record is being registered at - a register entry cannot be saved without an organisation.',
  });
}

/** Infer an org from a facility only (used by repairs); undefined when unknown. */
export async function inferOrgIdForFacility(facilityId?: string): Promise<string | undefined> {
  if (!facilityId) return undefined;
  try {
    const hosp = await hospitalsDB().get(facilityId) as HospitalDoc;
    return hosp?.orgId || undefined;
  } catch {
    return undefined;
  }
}

export interface RegisterOrgRepairResult {
  scanned: number;
  stamped: number;
  /** Orphans whose facility is unknown on this device; left untouched. */
  unresolved: number;
}

/**
 * Stamp `orgId` on birth/death/ANC/immunization/admission documents that were saved
 * before the services refused org-less writes. The org is inferred from the
 * record's own facility; a record whose facility cannot be resolved is left
 * alone (never guessed). Idempotent: documents that already carry an orgId are
 * not touched, so a second run writes nothing. Not run on every load - call it
 * from a sync-idle repair pass.
 */
export async function repairRegisterOrgIds(): Promise<RegisterOrgRepairResult> {
  const targets = [
    { db: birthsDB(), type: 'birth' },
    { db: deathsDB(), type: 'death' },
    { db: ancDB(), type: 'anc_visit' },
    { db: immunizationsDB(), type: 'immunization' },
    // Ward admissions from the admit form carried no orgId until 2026-10-29;
    // the tenant validator kept them on the device that made them, invisible
    // even there. Same facilityId field, same repair.
    { db: wardDB(), type: 'admission' },
  ] as const;
  const result: RegisterOrgRepairResult = { scanned: 0, stamped: 0, unresolved: 0 };
  const cache = new Map<string, string | undefined>();
  for (const { db, type } of targets) {
    const rows = await findByType<{ _id: string; orgId?: string; facilityId?: string; isDeleted?: boolean }>(db, type);
    for (const row of rows) {
      result.scanned++;
      if (row.orgId) continue;
      const fid = row.facilityId;
      if (fid && !cache.has(fid)) cache.set(fid, await inferOrgIdForFacility(fid));
      const orgId = fid ? cache.get(fid) : undefined;
      if (!orgId) { result.unresolved++; continue; }
      try {
        const fresh = await db.get(row._id) as { orgId?: string };
        if (fresh.orgId) continue;
        await db.put({ ...fresh, orgId, updatedAt: new Date().toISOString() });
        result.stamped++;
      } catch {
        result.unresolved++;
      }
    }
  }
  return result;
}

/**
 * Resolve the organisation an org-scoped document belongs to, or refuse it.
 *
 * Generalises `resolveRegisterOrgId` for every create path whose database is
 * `orgScoped` in DATABASE_SYNC_CONFIGS: a document without `orgId` never
 * replicates (the tenant validator rejects it) and `filterByScope` hides it
 * from its own author. Order: explicit orgId, the linked patient's org, the
 * facility's org, the caller-supplied fallback (normally `scope.orgId`).
 * Throws a ValidationError when nothing resolves.
 *
 * `label` names the record in the error ("triage", "follow-up", ...).
 */
export async function resolveDocOrgId(
  input: { orgId?: string; facilityId?: string; patientId?: string },
  label: string,
  fallbackOrgId?: string,
): Promise<string> {
  if (input.orgId) {
    // The fallback is the caller's own org; an explicit, different one is a
    // cross-tenant filing.
    if (fallbackOrgId && input.orgId !== fallbackOrgId) {
      throw new ValidationError({ orgId: `This ${label} cannot be saved under a different organisation.` });
    }
    return input.orgId;
  }
  if (input.patientId) {
    try {
      const patient = await patientsDB().get(input.patientId) as { orgId?: string };
      if (patient?.orgId) return patient.orgId;
    } catch {
      // patient not on this device; fall through
    }
  }
  const fromFacility = await inferOrgIdForFacility(input.facilityId);
  if (fromFacility) return fromFacility;
  if (fallbackOrgId) return fallbackOrgId;
  throw new ValidationError({
    orgId: `This ${label} cannot be saved because its organisation could not be determined. Select a facility or patient that belongs to an organisation.`,
  });
}
