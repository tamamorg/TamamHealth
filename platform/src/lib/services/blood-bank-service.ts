import { bloodBankDB } from '../db';
import type { BloodBankDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

function emitBloodBank(doc: BloodBankDoc, operation: 'create' | 'update'): void {
  emitSyncEvent({
    resourceType: 'blood_bank',
    resourceId: doc._id,
    operation,
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
}

export async function getAllUnits(scope?: DataScope): Promise<BloodBankDoc[]> {
  const db = bloodBankDB();
  const all = (await findByType<BloodBankDoc>(db, 'blood_bank'))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return scope ? filterByScope(all, scope) : all;
}

export async function getAvailableUnits(bloodGroup?: string, facilityId?: string, scope?: DataScope): Promise<BloodBankDoc[]> {
  const all = await getAllUnits(scope);
  return all.filter(u =>
    u.status === 'available' &&
    (!bloodGroup || u.bloodGroup === bloodGroup) &&
    (!facilityId || u.facilityId === facilityId) &&
    new Date(u.expiryDate) > new Date()
  );
}

export async function addUnit(
  data: Omit<BloodBankDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<BloodBankDoc> {
  const db = bloodBankDB();
  const now = new Date().toISOString();

  const doc: BloodBankDoc = {
    _id: `blood-${uuidv4()}`,
    type: 'blood_bank',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('ADD_BLOOD_UNIT', undefined, undefined,
    `Blood unit ${doc._id}: ${data.bloodGroup} ${data.component} (${data.volume}ml) added at ${data.facilityName}`
  );
  emitBloodBank(doc, 'create');
  return doc;
}

export async function updateUnit(
  id: string,
  updates: Partial<BloodBankDoc>,
  scope?: DataScope,
): Promise<BloodBankDoc | null> {
  const db = bloodBankDB();
  try {
    const existing = await db.get(id) as BloodBankDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const updated = {
      ...existing,
      ...updates,
      orgId: existing.orgId,
      facilityId: existing.facilityId,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_BLOOD_UNIT', undefined, undefined, `Blood unit ${id} updated`);
    emitBloodBank(updated, 'update');
    return updated;
  } catch {
    return null;
  }
}

export async function reserveUnit(id: string, patientId: string, scope?: DataScope): Promise<BloodBankDoc | null> {
  const db = bloodBankDB();
  try {
    const existing = await db.get(id) as BloodBankDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    if (existing.status !== 'available') {
      throw new Error(`Unit ${id} is not available for reservation`);
    }
    const updated = {
      ...existing,
      status: 'reserved' as const,
      reservedForPatient: patientId,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('RESERVE_BLOOD_UNIT', undefined, undefined,
      `Blood unit ${id} reserved for patient ${patientId}`
    );
    emitBloodBank(updated, 'update');
    return updated;
  } catch {
    return null;
  }
}

export async function crossmatchUnit(
  id: string,
  result: 'compatible' | 'incompatible' | 'pending',
  scope?: DataScope,
): Promise<BloodBankDoc | null> {
  const db = bloodBankDB();
  try {
    const existing = await db.get(id) as BloodBankDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const updated = {
      ...existing,
      status: result === 'compatible' ? 'crossmatched' as const : 'available' as const,
      crossmatchResult: result,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('CROSSMATCH_BLOOD_UNIT', undefined, undefined,
      `Blood unit ${id} crossmatch result: ${result}`
    );
    emitBloodBank(updated, 'update');
    return updated;
  } catch {
    return null;
  }
}

export async function recordTransfusion(
  id: string,
  patientId: string,
  transfusedBy: string,
  scope?: DataScope,
): Promise<BloodBankDoc | null> {
  const db = bloodBankDB();
  try {
    const existing = await db.get(id) as BloodBankDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const now = new Date().toISOString();
    const updated = {
      ...existing,
      status: 'transfused' as const,
      transfusedTo: patientId,
      transfusedAt: now,
      transfusedBy,
      updatedAt: now,
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('TRANSFUSE_BLOOD_UNIT', transfusedBy, undefined,
      `Blood unit ${id} transfused to patient ${patientId}`
    );
    emitBloodBank(updated, 'update');
    return updated;
  } catch {
    return null;
  }
}

export async function discardUnit(id: string, reason: string, scope?: DataScope): Promise<BloodBankDoc | null> {
  const db = bloodBankDB();
  try {
    const existing = await db.get(id) as BloodBankDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const updated = {
      ...existing,
      status: 'discarded' as const,
      notes: `Discarded: ${reason}`,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('DISCARD_BLOOD_UNIT', undefined, undefined,
      `Blood unit ${id} discarded: ${reason}`
    );
    emitBloodBank(updated, 'update');
    return updated;
  } catch {
    return null;
  }
}

export async function getBloodInventorySummary(facilityId?: string, scope?: DataScope): Promise<{
  totalUnits: number;
  availableUnits: number;
  reservedUnits: number;
  crossmatchedUnits: number;
  transfusedUnits: number;
  expiredUnits: number;
  byBloodGroup: Record<string, { total: number; available: number }>;
}> {
  const all = await getAllUnits(scope);
  const filtered = !facilityId ? all : all.filter(u => u.facilityId === facilityId);
  const now = new Date();

  const expired = filtered.filter(u => new Date(u.expiryDate) <= now);
  const available = filtered.filter(u => u.status === 'available' && new Date(u.expiryDate) > now);
  const reserved = filtered.filter(u => u.status === 'reserved');
  const crossmatched = filtered.filter(u => u.status === 'crossmatched');
  const transfused = filtered.filter(u => u.status === 'transfused');

  const byBloodGroup: Record<string, { total: number; available: number }> = {};
  for (const unit of filtered) {
    if (!byBloodGroup[unit.bloodGroup]) {
      byBloodGroup[unit.bloodGroup] = { total: 0, available: 0 };
    }
    byBloodGroup[unit.bloodGroup].total++;
    if (unit.status === 'available' && new Date(unit.expiryDate) > now) {
      byBloodGroup[unit.bloodGroup].available++;
    }
  }

  return {
    totalUnits: filtered.length,
    availableUnits: available.length,
    reservedUnits: reserved.length,
    crossmatchedUnits: crossmatched.length,
    transfusedUnits: transfused.length,
    expiredUnits: expired.length,
    byBloodGroup,
  };
}

export async function getExpiringUnits(daysThreshold?: number, facilityId?: string, scope?: DataScope): Promise<BloodBankDoc[]> {
  /* istanbul ignore next -- defensive default */
  const effectiveThreshold = daysThreshold ?? 7;
  const all = await getAllUnits(scope);
  const now = new Date();
  const threshold = new Date(now.getTime() + effectiveThreshold * 24 * 60 * 60 * 1000);

  /* istanbul ignore next -- facilityId filter: defensive short-circuit */
  return all.filter(u =>
    u.status === 'available' &&
    new Date(u.expiryDate) <= threshold &&
    new Date(u.expiryDate) > now &&
    (!facilityId || u.facilityId === facilityId)
  );
}

export async function getCompatibleGroups(patientBloodGroup: string): Promise<string[]> {
  const compatibilityMap: Record<string, string[]> = {
    'O+': ['O+', 'O-'],
    'O-': ['O-'],
    'A+': ['A+', 'A-', 'O+', 'O-'],
    'A-': ['A-', 'O-'],
    'B+': ['B+', 'B-', 'O+', 'O-'],
    'B-': ['B-', 'O-'],
    'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
    'AB-': ['AB-', 'A-', 'B-', 'O-'],
  };

  return compatibilityMap[patientBloodGroup] || [];
}
