import { deathsDB } from '../db';
import type { DeathRegistrationDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { updatePatient } from './patient-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { jubaYearMonth, jubaIsInMonth, isInRange } from '../time-juba';

export async function getAllDeaths(scope?: DataScope): Promise<DeathRegistrationDoc[]> {
  const db = deathsDB();
  const all = (await findByType<DeathRegistrationDoc>(db, 'death'))
    .filter(d => d && d.isDeleted !== true)
    .sort((a, b) => new Date(b.dateOfDeath || '').getTime() - new Date(a.dateOfDeath || '').getTime());
  return scope ? filterByScope(all, scope) : all;
}

export async function getDeathsByFacility(facilityId: string): Promise<DeathRegistrationDoc[]> {
  const all = await getAllDeaths();
  return all.filter(d => d.facilityId === facilityId);
}

export async function createDeath(data: Omit<DeathRegistrationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>): Promise<DeathRegistrationDoc> {
  const db = deathsDB();
  const now = new Date().toISOString();
  const id = `death-${uuidv4()}`;
  const doc: DeathRegistrationDoc = {
    _id: id,
    type: 'death',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('REGISTER_DEATH', undefined, undefined, `Registered death ${doc._id}: ${data.deceasedFirstName} ${data.deceasedSurname}, cause: ${data.immediateCause || 'unspecified'}`);
  emitSyncEvent({
    resourceType: 'death',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  // If this death is linked to an existing patient record, mark that patient as deceased
  // so dashboards, search results, and patient lookups reflect the new status.
  if (data.patientId) {
    try {
      await updatePatient(data.patientId, {
        isDeceased: true,
        deceasedDate: data.dateOfDeath || now.slice(0, 10),
        followUpStatus: 'died',
        isActive: false,
      });
    } catch {
      // Don't fail the death registration if the patient patch fails;
      // the death record itself is the source of truth for CRVS.
    }
  }

  return doc;
}

export async function updateDeath(id: string, data: Partial<DeathRegistrationDoc>): Promise<DeathRegistrationDoc | null> {
  const db = deathsDB();
  try {
    const existing = await db.get(id) as DeathRegistrationDoc;
    const updated = {
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'death',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    return updated;
  } catch {
    return null;
  }
}

export async function deleteDeath(id: string): Promise<boolean> {
  const db = deathsDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as DeathRegistrationDoc;
    await db.remove(doc);
    emitSyncEvent({
      resourceType: 'death',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
      hospitalId: typed.facilityId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param range Optional half-open [from, to) ISO instant range to bound the
 *   stats to a reporting period (e.g. a DHIS2 export month), filtered on the
 *   death's own `dateOfDeath`. Omit for the existing all-time behavior —
 *   added additively so this call stays backward-compatible for callers that
 *   want the lifetime total (e.g. dashboards).
 */
export async function getDeathStats(scope?: DataScope, range?: { from: string; to: string }) {
  let all = await getAllDeaths(scope);
  if (range) {
    all = all.filter(d => isInRange(d.dateOfDeath, range));
  }
  const thisYear = new Date().getFullYear().toString();
  const thisMonth = jubaYearMonth();
  const maternalDeaths = all.filter(d => d.maternalDeath);
  const under5 = all.filter(d => d.ageAtDeath != null && d.ageAtDeath < 5);
  const neonatal = all.filter(d => d.ageAtDeath != null && d.ageAtDeath < 0.077); // < 28 days ≈ 0.077 years

  // Top causes by ICD-11
  const causeCounts: Record<string, { code: string; cause: string; count: number }> = {};
  for (const d of all) {
    const key = d.underlyingICD11 || d.immediateICD11 || 'unknown';
    const cause = d.underlyingCause || d.immediateCause || 'Unknown';
    if (!causeCounts[key]) causeCounts[key] = { code: key, cause, count: 0 };
    causeCounts[key].count++;
  }
  const topCauses = Object.values(causeCounts).sort((a, b) => b.count - a.count).slice(0, 10);

  return {
    total: all.length,
    thisMonth: all.filter(d => jubaIsInMonth(d.dateOfDeath, thisMonth)).length,
    thisYear: all.filter(d => (d.dateOfDeath || '').startsWith(thisYear)).length,
    maternalDeaths: maternalDeaths.length,
    under5Deaths: under5.length,
    neonatalDeaths: neonatal.length,
    withICD11Code: all.filter(d => d.underlyingICD11 || d.immediateICD11).length,
    registered: all.filter(d => d.deathRegistered).length,
    notified: all.filter(d => d.deathNotified).length,
    byGender: {
      male: all.filter(d => d.deceasedGender === 'Male').length,
      female: all.filter(d => d.deceasedGender === 'Female').length,
    },
    byMannerOfDeath: all.reduce((acc, d) => { const m = d.mannerOfDeath || 'Unknown'; acc[m] = (acc[m] || 0) + 1; return acc; }, {} as Record<string, number>),
    topCauses,
    byState: all.reduce((acc, d) => { const st = d.state || 'Unknown'; acc[st] = (acc[st] || 0) + 1; return acc; }, {} as Record<string, number>),
  };
}

export { COMMON_ICD11_CODES } from '../icd11-codes';
