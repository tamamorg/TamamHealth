import { birthsDB, ancDB } from '../db';
import type { BirthRegistrationDoc, ANCVisitDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { jubaYearMonth, jubaIsInMonth, isInRange } from '../time-juba';
import { findByType } from './db-query';

/**
 * Look up ANC visits for a mother by name (case-insensitive). Used after a
 * birth is registered so the prenatal record can be linked back. We do a name
 * match because ANC and birth records aren't always created with the same
 * patient ID — many mothers in rural settings don't carry an ID.
 */
async function findAncVisitsForMother(motherName: string): Promise<ANCVisitDoc[]> {
  /* istanbul ignore next -- defensive: callers always pass non-empty string */
  if (!motherName) return [];
  try {
    const db = ancDB();
    const target = motherName.trim().toLowerCase();
    const docs = await findByType<ANCVisitDoc>(db, 'anc_visit');
    /* istanbul ignore next -- defensive null-safety in filter */
    return docs.filter(d => d && d.isDeleted !== true && (d.motherName || '').trim().toLowerCase() === target);
  } catch {
    return [];
  }
}

export async function getAllBirths(scope?: DataScope): Promise<BirthRegistrationDoc[]> {
  const db = birthsDB();
  const all = (await findByType<BirthRegistrationDoc>(db, 'birth'))
    .filter(d => d.isDeleted !== true);
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => new Date(b.dateOfBirth || '').getTime() - new Date(a.dateOfBirth || '').getTime());
  return scope ? filterByScope(all, scope) : all;
}

export async function getBirthsByFacility(facilityId: string): Promise<BirthRegistrationDoc[]> {
  const all = await getAllBirths();
  return all.filter(b => b.facilityId === facilityId);
}

export async function getBirthsByState(state: string): Promise<BirthRegistrationDoc[]> {
  const all = await getAllBirths();
  return all.filter(b => b.state === state);
}

export async function createBirth(data: Omit<BirthRegistrationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>): Promise<BirthRegistrationDoc> {
  const db = birthsDB();
  const now = new Date().toISOString();
  const id = `birth-${uuidv4()}`;

  // Best-effort: find any ANC visits this mother has on file so we can
  // bidirectionally link the prenatal history with the birth record.
  let linkedAncMotherId: string | undefined;
  let ancVisits: ANCVisitDoc[] = [];
  if (!data.linkedAncMotherId && data.motherName) {
    try {
      ancVisits = await findAncVisitsForMother(data.motherName);
      if (ancVisits.length > 0) {
        linkedAncMotherId = ancVisits[0].motherId;
      }
    } catch {
      // ignore — birth registration must not fail because of ANC linkage
    }
  }

  const doc: BirthRegistrationDoc = {
    _id: id,
    type: 'birth',
    ...data,
    linkedAncMotherId: data.linkedAncMotherId || linkedAncMotherId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('REGISTER_BIRTH', undefined, undefined, `Registered birth ${doc._id}: ${data.childFirstName} ${data.childSurname}, gender: ${data.childGender}`);
  emitSyncEvent({
    resourceType: 'birth',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  // Write the birth id back onto every matching ANC visit so the ANC module
  // can flag the mother as "Delivered" without a separate query.
  if (ancVisits.length > 0) {
    const ancDb = ancDB();
    for (const visit of ancVisits) {
      try {
        const fresh = await ancDb.get(visit._id) as ANCVisitDoc;
        await ancDb.put({ ...fresh, linkedBirthId: id, updatedAt: now });
      } catch {
        // Skip individual failures — partial linkage is better than none.
      }
    }
  }

  return doc;
}

export async function updateBirth(id: string, data: Partial<BirthRegistrationDoc>): Promise<BirthRegistrationDoc | null> {
  const db = birthsDB();
  try {
    const existing = await db.get(id) as BirthRegistrationDoc;
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
      resourceType: 'birth',
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

export async function deleteBirth(id: string): Promise<boolean> {
  const db = birthsDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as BirthRegistrationDoc;
    await db.remove(doc);
    emitSyncEvent({
      resourceType: 'birth',
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
 *   birth's own `dateOfBirth`. Omit for the existing all-time behavior —
 *   added additively so this call stays backward-compatible for callers that
 *   want the lifetime total (e.g. dashboards).
 */
export async function getBirthStats(scope?: DataScope, range?: { from: string; to: string }) {
  let all = await getAllBirths(scope);
  if (range) {
    all = all.filter(b => isInRange(b.dateOfBirth, range));
  }
  const thisMonth = jubaYearMonth();
  const thisYear = new Date().getFullYear().toString();
  return {
    total: all.length,
    /* istanbul ignore next -- defensive null-safety in filter */
    thisMonth: all.filter(b => jubaIsInMonth(b.dateOfBirth, thisMonth)).length,
    /* istanbul ignore next -- defensive null-safety in filter */
    thisYear: all.filter(b => (b.dateOfBirth || '').startsWith(thisYear)).length,
    byGender: {
      male: all.filter(b => b.childGender === 'Male').length,
      female: all.filter(b => b.childGender === 'Female').length,
    },
    byDeliveryType: {
      normal: all.filter(b => b.deliveryType === 'normal').length,
      caesarean: all.filter(b => b.deliveryType === 'caesarean').length,
      assisted: all.filter(b => b.deliveryType === 'assisted').length,
    },
    byState: all.reduce((acc, b) => { const st = b.state || 'Unknown'; acc[st] = (acc[st] || 0) + 1; return acc; }, {} as Record<string, number>),
  };
}
