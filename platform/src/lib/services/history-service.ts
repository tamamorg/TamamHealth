/**
 * Patient history service — past medical, surgical, family and social history.
 *
 * Anchored to the patient and read at every visit, like the Problem List
 * (`problem-service.ts`), whose shape this follows. The one deliberate
 * difference is that nothing here is deleted: a mistaken entry is marked
 * 'entered_in_error' and drops out of every reader, but stays on disk, because
 * a signed note may already carry a snapshot of it and the chart has to be able
 * to say where that line came from.
 */
import { historyEntriesDB, hospitalsDB, patientsDB } from '../db';
import type { HistoryEntryDoc, HospitalDoc, PatientDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { isHistoryDomain } from '../clinical/patient-history';

async function inferOrgIdFromHospital(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const hosp = await hospitalsDB().get(hospitalId) as HospitalDoc;
    return hosp.orgId;
  } catch {
    return undefined;
  }
}

async function readPatient(patientId: string): Promise<PatientDoc | null> {
  try {
    return await patientsDB().get(patientId) as PatientDoc;
  } catch {
    return null;
  }
}

/** Free-text fields a caller may set; trimmed, and dropped when left blank. */
const TEXT_FIELDS = ['title', 'relation', 'factor', 'when', 'facility', 'detail'] as const;

function tidy<T extends Partial<HistoryEntryDoc>>(data: T): T {
  const out = { ...data };
  for (const field of TEXT_FIELDS) {
    const value = out[field];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    // `title` is required and validated by the caller; the rest are optional,
    // and an empty string would otherwise sync as a field that says nothing.
    out[field] = (trimmed || (field === 'title' ? '' : undefined)) as never;
  }
  return out;
}

/**
 * Every history entry for a patient, oldest first — the order they were
 * recorded in, which is the order a clinician built the history up. Includes
 * entries marked in error; readers filter with `activeHistory`.
 *
 * `scope` is required: the local database holds every organisation the device
 * has replicated, and family and social history is not something to read
 * across that line because a caller forgot an argument.
 */
export async function getHistoryByPatient(patientId: string, scope: DataScope): Promise<HistoryEntryDoc[]> {
  const rows = await findByType<HistoryEntryDoc>(
    historyEntriesDB(),
    'history_entry',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  return filterByScope(rows, scope)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export type CreateHistoryEntryInput =
  Omit<HistoryEntryDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'>
  & { status?: HistoryEntryDoc['status'] };

export async function createHistoryEntry(input: CreateHistoryEntryInput): Promise<HistoryEntryDoc> {
  const data = tidy(input);
  if (!isHistoryDomain(data.domain)) throw new Error('Choose which part of the history this belongs to.');
  if (!data.title) throw new Error('Say what the history entry is before saving it.');
  if (!data.patientId) throw new Error('A history entry needs a patient.');

  // Every entry belongs to a facility and an organisation. A writer with no
  // home facility (an org-level account) would otherwise create an entry with
  // no facility tie, which replicates to every device in the organisation and
  // is shown at every facility — so it is filed at the patient's own. And an
  // entry with no organisation is refused here rather than saved: the sync
  // validator rejects it, and tenant filtering hides it even on this device,
  // so "saved" would be a lie the clinician finds out about later.
  const patient = (!data.hospitalId || !data.orgId) ? await readPatient(data.patientId) : null;
  const hospitalId = data.hospitalId || patient?.registrationHospital || undefined;
  const orgId = data.orgId || await inferOrgIdFromHospital(hospitalId) || patient?.orgId;
  if (!orgId) throw new Error('This entry could not be saved: your account is not linked to an organisation.');

  const db = historyEntriesDB();
  const now = new Date().toISOString();
  const doc: HistoryEntryDoc = {
    ...data,
    hospitalId,
    _id: `history-${uuidv4()}`,
    type: 'history_entry',
    status: data.status ?? 'active',
    orgId,
    createdBy: data.recordedBy,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  // The domain only: what a family member had, or how much someone drinks, does
  // not belong in an audit line that administrators read.
  await logAuditSafe(
    'HISTORY_ENTRY_CREATED',
    data.recordedBy,
    data.recordedByName,
    `History entry ${doc._id} recorded; domain=${doc.domain}`,
    true,
    { orgId: doc.orgId, hospitalId: doc.hospitalId, patientId: doc.patientId, resourceType: 'history_entry', resourceId: doc._id },
  );
  emitSyncEvent({
    resourceType: 'history_entry',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.hospitalId,
  });
  return doc;
}

/** Fields an edit may change. Ownership and identity are fixed at creation. */
export type HistoryEntryPatch = Partial<Pick<HistoryEntryDoc,
  'title' | 'relation' | 'factor' | 'when' | 'facility' | 'detail' | 'status'>>;

export async function updateHistoryEntry(
  id: string,
  patch: HistoryEntryPatch,
  scope: DataScope,
  actor: { userId?: string; userName?: string } = {},
): Promise<HistoryEntryDoc | null> {
  const db = historyEntriesDB();
  let existing: HistoryEntryDoc;
  try {
    existing = await db.get(id) as HistoryEntryDoc;
  } catch {
    return null;
  }
  // The local database holds every organisation this device has replicated;
  // an id is not permission. An entry outside the caller's scope is answered
  // exactly like one that does not exist.
  if (filterByScope([existing], scope).length === 0) return null;
  const data = tidy(patch);
  if ('title' in data && !data.title) throw new Error('Say what the history entry is before saving it.');

  const updated: HistoryEntryDoc = {
    ...existing,
    ...data,
    // The original recorder stays; this says who changed what they wrote.
    updatedBy: actor.userId ?? existing.updatedBy,
    updatedByName: actor.userName ?? existing.updatedByName,
    _id: existing._id,
    _rev: existing._rev,
    type: 'history_entry',
    updatedAt: new Date().toISOString(),
  };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe(
    updated.status === 'entered_in_error' && existing.status !== 'entered_in_error'
      ? 'HISTORY_ENTRY_MARKED_IN_ERROR'
      : 'HISTORY_ENTRY_UPDATED',
    actor.userId,
    actor.userName,
    `History entry ${id} updated; domain=${updated.domain}`,
    true,
    { orgId: updated.orgId, hospitalId: updated.hospitalId, patientId: updated.patientId, resourceType: 'history_entry', resourceId: id },
  );
  emitSyncEvent({
    resourceType: 'history_entry',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    orgId: updated.orgId,
    hospitalId: updated.hospitalId,
  });
  return updated;
}

/** Withdraw a mistaken entry. It leaves every reader and stays on disk. */
export function markHistoryEntryInError(
  id: string,
  scope: DataScope,
  actor: { userId?: string; userName?: string } = {},
): Promise<HistoryEntryDoc | null> {
  return updateHistoryEntry(id, { status: 'entered_in_error' }, scope, actor);
}
