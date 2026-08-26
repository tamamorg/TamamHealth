import { triageDB } from '../db';
import type { TriageDoc, TriagePriority } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { jubaDate } from '../time-juba';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import { isLowerTriagePriority, validateTriageVitals } from '../clinical/vitals';

function assertTriageVitalSafety(doc: Partial<TriageDoc>): void {
  const errors = validateTriageVitals({
    temperature: doc.temperature,
    pulse: doc.pulse,
    respiratoryRate: doc.respiratoryRate,
    oxygenSaturation: doc.oxygenSaturation,
    systolic: doc.systolic,
    diastolic: doc.diastolic,
    weight: doc.weight,
    painScore: doc.painScore,
    bloodGlucose: doc.bloodGlucose,
    gcs: doc.gcs,
    muac: doc.muac,
  });
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);

  const overrideReason = doc.vitalUrgencyOverrideReason?.trim();
  if (doc.vitalUrgencyOverridden && !overrideReason) {
    throw new Error('A reason is required to override the recommended triage urgency.');
  }
  if (
    doc.priority &&
    doc.vitalUrgencyRecommendation &&
    isLowerTriagePriority(doc.priority, doc.vitalUrgencyRecommendation) &&
    (!doc.vitalUrgencyOverridden || !overrideReason)
  ) {
    throw new Error('Saving below the recommended triage urgency requires a recorded override reason.');
  }
}

/**
 * ETAT priority calculator — encodes the WHO decision tree.
 * Returns the priority string or '' if the assessment is incomplete.
 */
export function calculatePriority(data: {
  airway: TriageDoc['airway'] | '';
  breathing: TriageDoc['breathing'] | '';
  circulation: TriageDoc['circulation'] | '';
  consciousness: TriageDoc['consciousness'] | '';
}): TriagePriority | '' {
  if (!data.airway || !data.breathing || !data.circulation || !data.consciousness) return '';
  // RED — any life-threatening sign
  if (
    data.airway === 'obstructed' ||
    data.breathing === 'absent' ||
    data.circulation === 'absent' ||
    data.consciousness === 'unresponsive'
  ) return 'RED';
  // YELLOW — any priority sign
  if (
    data.breathing === 'distressed' ||
    data.circulation === 'impaired' ||
    data.consciousness === 'pain' ||
    data.consciousness === 'verbal'
  ) return 'YELLOW';
  return 'GREEN';
}

// Valid triage status transitions (state machine)
const VALID_TRANSITIONS: Record<string, string[]> = {
  // 'lwbs' (left without being seen, KAN-100) is reachable from either wait
  // state — a patient can walk out before triage starts or after it's done
  // but before a room/provider is free. It was missing here, so calling
  // updateTriage(id, {status:'lwbs'}) always threw an "invalid transition"
  // caught below and silently returned null.
  pending: ['seen', 'admitted', 'discharged', 'referred', 'lwbs'],
  seen: ['admitted', 'discharged', 'referred', 'lwbs'],
  admitted: ['discharged', 'referred'],
  discharged: [],
  referred: ['discharged'],
  lwbs: [],
};

export async function getAllTriage(scope?: DataScope): Promise<TriageDoc[]> {
  const db = triageDB();
  const all = await findByType<TriageDoc>(db, 'triage');
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => (b.triagedAt || '').localeCompare(a.triagedAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

/** Triages for a specific patient, newest first. */
export async function getTriageByPatient(patientId: string, scope?: DataScope): Promise<TriageDoc[]> {
  const rows = await findByType<TriageDoc>(
    triageDB(),
    'triage',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  const visible = scope ? filterByScope(rows, scope) : rows;
  return visible.sort((a, b) => (b.triagedAt || '').localeCompare(a.triagedAt || ''));
}

export async function getTriageByEncounter(encounterId: string): Promise<TriageDoc | null> {
  const rows = await findByType<TriageDoc>(triageDB(), 'triage', { encounterId }, { indexFields: ['type', 'encounterId'] });
  return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null;
}

/** Active (pending) triages for the current facility — feeds the nurse queue. */
export async function getActiveTriage(scope?: DataScope): Promise<TriageDoc[]> {
  const all = await getAllTriage(scope);
  return all.filter(t => t.status === 'pending' || t.status === 'seen');
}

export async function createTriage(
  data: Omit<TriageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<TriageDoc> {
  assertTriageVitalSafety(data);
  const db = triageDB();
  const now = new Date().toISOString();
  const doc: TriageDoc = withPendingOfflineSync({
    _id: `triage-${uuidv4()}`,
    type: 'triage',
    ...data,
    createdAt: now,
    updatedAt: now,
  }, now);
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('TRIAGE_RECORDED', data.triagedBy, data.triagedByName,
    `${data.priority} triage for ${data.patientName} (${data.patientId})`
  );
  if (data.vitalUrgencyOverridden) {
    await logAuditSafe('TRIAGE_URGENCY_OVERRIDE', data.triagedBy, data.triagedByName,
      `Vital urgency ${data.vitalUrgencyRecommendation} overridden to ${data.priority} for ${data.patientName} (${data.patientId}). Reason: ${data.vitalUrgencyOverrideReason?.trim()}`
    );
  }
  emitSyncEvent({
    resourceType: 'triage',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updateTriage(
  id: string,
  updates: Partial<TriageDoc>
): Promise<TriageDoc> {
  const db = triageDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await db.get(id) as TriageDoc;

    // Enforce valid status transitions
    if (updates.status && updates.status !== existing.status) {
      /* istanbul ignore next -- defensive: all known statuses are in VALID_TRANSITIONS */
      const allowed = VALID_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(updates.status)) {
        throw new Error(`Invalid triage status transition: ${existing.status} → ${updates.status}`);
      }
    }

    const updated: TriageDoc = withPendingOfflineSync({ ...existing, ...updates, updatedAt: new Date().toISOString() });
    assertTriageVitalSafety(updated);
    let resp: Awaited<ReturnType<typeof db.put>>;
    try {
      resp = await db.put(updated);
    } catch (error) {
      const conflict = (error as { name?: string; status?: number } | undefined);
      if ((conflict?.name === 'conflict' || conflict?.status === 409) && attempt < 2) continue;
      throw error;
    }
    updated._rev = resp.rev;
    if (updates.status) {
      await logAuditSafe('TRIAGE_STATUS_CHANGE', updates.handoffTo, updates.handoffToName,
        `Triage ${id}: ${existing.status} → ${updates.status} for ${existing.patientName}`
      );
    }
    if (
      updated.vitalUrgencyOverridden &&
      (!existing.vitalUrgencyOverridden ||
        existing.vitalUrgencyOverrideReason !== updated.vitalUrgencyOverrideReason ||
        existing.priority !== updated.priority)
    ) {
      await logAuditSafe('TRIAGE_URGENCY_OVERRIDE', existing.triagedBy, existing.triagedByName,
        `Vital urgency ${updated.vitalUrgencyRecommendation} overridden to ${updated.priority} for ${updated.patientName} (${updated.patientId}). Reason: ${updated.vitalUrgencyOverrideReason?.trim()}`
      );
    }
    emitSyncEvent({
      resourceType: 'triage',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    return updated;
  }
  throw new Error('Triage changed on another workstation. Refresh and try again.');
}

/** Stats for the nurse dashboard header (active reds, today's totals). */
export async function getTriageStats(scope?: DataScope) {
  const all = await getAllTriage(scope);
  const today = jubaDate();
  /* istanbul ignore next -- defensive null-safety in filter */
  const todays = all.filter(t => t.triagedAt ? jubaDate(t.triagedAt) === today : false);
  return {
    total: all.length,
    todayTotal: todays.length,
    todayRed: todays.filter(t => t.priority === 'RED').length,
    todayYellow: todays.filter(t => t.priority === 'YELLOW').length,
    todayGreen: todays.filter(t => t.priority === 'GREEN').length,
    pending: all.filter(t => t.status === 'pending').length,
  };
}
