/**
 * Census figures a data clerk SUBMITS for a facility (stored `facility_census`
 * documents). Not to be confused with `facility-census.ts`, which COMPUTES
 * live patient/visit totals from the records that exist.
 */
import { getDB } from '../db';
import type { BaseDoc } from '../db-types';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { resolveRegisterOrgId } from './register-org';
import { ValidationError } from '../validation';

export interface FacilityCensusDoc extends BaseDoc {
  type: 'facility_census';
  facilityId: string;
  facilityName?: string;
  orgId?: string;
  date: string;
  census: Record<string, unknown>;
  submittedBy?: string;
  submittedByName?: string;
}

const db = () => getDB('tamamhealth_facility_census');

export async function getFacilityCensusByFacility(facilityId: string): Promise<FacilityCensusDoc[]> {
  const rows = await findByType<FacilityCensusDoc>(db(), 'facility_census', { facilityId }, { indexFields: ['type', 'facilityId'] });
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function saveFacilityCensus(input: Omit<FacilityCensusDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>): Promise<FacilityCensusDoc> {
  // A census filed against no facility (or the legacy 'unknown' placeholder)
  // names no org and is never reconciled with a real facility; refuse it.
  if (!input.facilityId || input.facilityId === 'unknown') {
    throw new ValidationError({ facilityId: 'A facility is required to file a census.' });
  }
  const orgId = await resolveRegisterOrgId(input);
  const store = db();
  const now = new Date().toISOString();
  const id = `facility-census-${input.facilityId}-${input.date}`;
  let existing: FacilityCensusDoc | null = null;
  try {
    existing = await store.get(id) as FacilityCensusDoc;
  } catch {
    existing = null;
  }

  const doc: FacilityCensusDoc = {
    ...(existing || {}),
    _id: id,
    _rev: existing?._rev,
    type: 'facility_census',
    ...input,
    orgId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const resp = await store.put(doc);
  doc._rev = resp.rev;

  await logAuditSafe(
    existing ? 'UPDATE_FACILITY_CENSUS' : 'CREATE_FACILITY_CENSUS',
    input.submittedBy,
    input.submittedByName,
    `Facility census ${input.facilityId} for ${input.date}`
  );
  emitSyncEvent({
    resourceType: 'facility_census',
    resourceId: doc._id,
    operation: existing ? 'update' : 'create',
    resourceVersion: doc._rev,
    userId: input.submittedBy,
    username: input.submittedByName,
    hospitalId: input.facilityId,
    orgId,
  });

  return doc;
}
