import { diseaseAlertsDB } from '../db';
import type { DiseaseAlertDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { emitSyncEvent } from './sync-event-service';

export async function getAllAlerts(scope?: DataScope): Promise<DiseaseAlertDoc[]> {
  const db = diseaseAlertsDB();
  const all = (await findByType<DiseaseAlertDoc>(db, 'disease_alert'))
    .sort((a, b) => (b.reportDate || '').localeCompare(a.reportDate || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getActiveAlerts(): Promise<DiseaseAlertDoc[]> {
  const all = await getAllAlerts();
  return all.filter(a => a.alertLevel === 'emergency' || a.alertLevel === 'warning');
}

/**
 * Alerts auto-raised from one medical record. (sourceRecordId, icd11Code) is
 * the dedupe key the record-save path checks so a re-saved or amended
 * consultation never double-counts a case.
 */
export async function getAlertsBySourceRecord(recordId: string): Promise<DiseaseAlertDoc[]> {
  const db = diseaseAlertsDB();
  const all = await findByType<DiseaseAlertDoc>(db, 'disease_alert');
  return all.filter(a => a.sourceRecordId === recordId);
}

export async function updateAlert(id: string, data: Partial<DiseaseAlertDoc>): Promise<DiseaseAlertDoc | null> {
  const db = diseaseAlertsDB();
  try {
    const existing = await db.get(id) as DiseaseAlertDoc;
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
      resourceType: 'disease_alert',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
    });
    return updated;
  } catch {
    return null;
  }
}

export async function deleteAlert(id: string): Promise<boolean> {
  const db = diseaseAlertsDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as DiseaseAlertDoc;
    await db.remove(doc);
    emitSyncEvent({
      resourceType: 'disease_alert',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
    });
    return true;
  } catch {
    return false;
  }
}

export async function createAlert(
  data: Omit<DiseaseAlertDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<DiseaseAlertDoc> {
  const db = diseaseAlertsDB();
  const now = new Date().toISOString();
  const doc: DiseaseAlertDoc = {
    _id: `alert-${uuidv4().slice(0, 8)}`,
    type: 'disease_alert',
    ...data,
    createdAt: now,
    updatedAt: now,
  } as DiseaseAlertDoc;
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'disease_alert',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
  });
  return doc;
}
