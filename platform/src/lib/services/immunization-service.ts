import { immunizationsDB } from '../db';
import type { ImmunizationDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import { emitSyncEvent } from './sync-event-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';

/**
 * The EPI antigens this deployment records. One list, exported: coverage
 * reporting, the immunizations module and the chart's own Immunizations
 * section all have to agree on what "a vaccine" is, and separate copies drift.
 */
export const VACCINE_NAMES = ['BCG', 'OPV', 'Penta', 'PCV', 'Rota', 'Measles', 'Yellow Fever', 'Vitamin A'] as const;

export async function getAllImmunizations(scope?: DataScope): Promise<ImmunizationDoc[]> {
  const db = immunizationsDB();
  const all = await findByType<ImmunizationDoc>(db, 'immunization');
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
  return scope ? filterByScope(all, scope) : all;
}

export async function getByPatient(patientId: string, scope?: DataScope): Promise<ImmunizationDoc[]> {
  const all = await getAllImmunizations(scope);
  return all.filter(i => i.patientId === patientId);
}

export async function getByFacility(facilityId: string): Promise<ImmunizationDoc[]> {
  const all = await getAllImmunizations();
  return all.filter(i => i.facilityId === facilityId);
}

export async function createImmunization(data: Omit<ImmunizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>): Promise<ImmunizationDoc> {
  const db = immunizationsDB();
  const now = new Date().toISOString();
  const id = `imm-${uuidv4()}`;
  const doc: ImmunizationDoc = {
    _id: id,
    type: 'immunization',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  emitSyncEvent({
    resourceType: 'immunization',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updateImmunization(id: string, data: Partial<ImmunizationDoc>): Promise<ImmunizationDoc | null> {
  const db = immunizationsDB();
  try {
    const existing = await db.get(id) as ImmunizationDoc;
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
      resourceType: 'immunization',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    await logAuditSafe('IMMUNIZATION_UPDATED', undefined, undefined, `Immunization ${id}: ${updated.vaccine} dose ${updated.doseNumber}`);
    return updated;
  } catch {
    return null;
  }
}

/**
 * Retain a dose that was charted against the wrong vaccine/patient/date as an
 * entered-in-error record. An administered clinical event is never physically
 * deleted: the reason and actor remain available to audit and sync consumers.
 */
export async function enterImmunizationInError(
  id: string,
  reason: string,
  actor?: { id?: string; name?: string },
): Promise<ImmunizationDoc> {
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw new Error('A reason is required to mark an immunization as entered in error.');
  const updated = await updateImmunization(id, {
    recordStatus: 'entered_in_error',
    statusReason: cleanReason,
    statusChangedAt: new Date().toISOString(),
    statusChangedBy: actor?.name || actor?.id,
  });
  if (!updated) throw new Error('The immunization could not be updated. Reload the chart and try again.');
  await logAuditSafe('IMMUNIZATION_ENTERED_IN_ERROR', actor?.id, actor?.name, `Immunization ${id}: ${cleanReason}`);
  return updated;
}

/**
 * Compatibility name for older callers. A recorded dose is not physically
 * deleted; deletion means retiring it as entered in error with provenance.
 */
export async function deleteImmunization(
  id: string,
  reason: string,
  actor?: { id?: string; name?: string },
): Promise<boolean> {
  await enterImmunizationInError(id, reason, actor);
  return true;
}

export async function getImmunizationStats(scope?: DataScope) {
  const all = (await getAllImmunizations(scope)).filter(i => i.recordStatus !== 'entered_in_error');
  const completed = all.filter(i => i.status === 'completed');
  const overdue = all.filter(i => i.status === 'overdue');
  const scheduled = all.filter(i => i.status === 'scheduled');
  const missed = all.filter(i => i.status === 'missed');

  // Unique children
  const childIds = new Set(all.map(i => i.patientId));
  const childrenWithAllDoses = new Set<string>();

  // Check fully immunized (has BCG + Penta3 + Measles1 completed)
  for (const childId of childIds) {
    const childRecords = completed.filter(i => i.patientId === childId);
    const hasBCG = childRecords.some(i => i.vaccine === 'BCG');
    const hasPenta3 = childRecords.some(i => i.vaccine === 'Penta' && i.doseNumber === 3);
    const hasMeasles1 = childRecords.some(i => i.vaccine === 'Measles' && i.doseNumber === 1);
    if (hasBCG && hasPenta3 && hasMeasles1) {
      childrenWithAllDoses.add(childId);
    }
  }

  const totalChildren = childIds.size;
  const coverageRate = totalChildren > 0 ? Math.round((childrenWithAllDoses.size / totalChildren) * 100) : 0;

  // By state
  const byState = all.reduce((acc, i) => {
    const st = i.state || 'Unknown';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalVaccinations: completed.length,
    totalChildren,
    fullyImmunized: childrenWithAllDoses.size,
    overdue: overdue.length,
    scheduled: scheduled.length,
    missed: missed.length,
    coverageRate,
    byState,
  };
}

// ===== Immunization Defaulter Tracker (Expert Priority: "Even if you don't do these other things, do this") =====

export interface ImmunizationDefaulter {
  patientId: string;
  patientName: string;
  gender: 'Male' | 'Female';
  dateOfBirth: string;
  ageMonths: number;
  vaccine: string;
  doseNumber: number;
  dueDate: string;
  daysOverdue: number;
  urgency: 'critical' | 'high' | 'medium'; // >30 days, >14 days, >0 days
  facilityName: string;
  state: string;
  lastVaccineDate?: string;
}

export async function getDefaulters(scope?: DataScope): Promise<ImmunizationDefaulter[]> {
  // Scope-aware: hospital users only see their slice.
  const all = (await getAllImmunizations(scope)).filter(i => i.recordStatus !== 'entered_in_error');
  const now = new Date();
  const defaulters: ImmunizationDefaulter[] = [];

  // Group by child
  const byChild = new Map<string, ImmunizationDoc[]>();
  for (const imm of all) {
    const existing = byChild.get(imm.patientId) || [];
    existing.push(imm);
    byChild.set(imm.patientId, existing);
  }

  for (const [, records] of byChild) {
    // Find records that are overdue or have a past nextDueDate with no completed follow-up
    const overdueRecords = records.filter(r => r.status === 'overdue' || r.status === 'missed');
    const scheduledRecords = records.filter(r => r.status === 'scheduled' && r.nextDueDate && new Date(r.nextDueDate) < now);

    const allOverdue = [...overdueRecords, ...scheduledRecords];

    for (const rec of allOverdue) {
      const dueDate = new Date(rec.nextDueDate || rec.dateGiven);
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 86400000));

      /* istanbul ignore next -- defensive: daysOverdue is always > 0 for overdue records */
      if (daysOverdue <= 0) continue;

      /* istanbul ignore next -- defensive null-safety */
      const dob = new Date(rec.dateOfBirth || '');
      const ageMonths = Math.floor((now.getTime() - dob.getTime()) / (30.44 * 86400000));

      // Find the most recent completed vaccine for this child
      const completedRecords = records.filter(r => r.status === 'completed');
      const lastCompleted = completedRecords.sort((a, b) =>
        new Date(b.dateGiven || '').getTime() - new Date(a.dateGiven || '').getTime()
      )[0];

      defaulters.push({
        patientId: rec.patientId,
        patientName: rec.patientName,
        gender: rec.gender,
        dateOfBirth: rec.dateOfBirth,
        ageMonths,
        vaccine: rec.vaccine,
        doseNumber: rec.doseNumber,
        dueDate: rec.nextDueDate || rec.dateGiven,
        daysOverdue,
        urgency: daysOverdue > 30 ? 'critical' : daysOverdue > 14 ? 'high' : 'medium',
        facilityName: rec.facilityName,
        state: rec.state,
        lastVaccineDate: lastCompleted?.dateGiven,
      });
    }
  }

  // Sort by urgency (most overdue first)
  return defaulters.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export async function getDefaultersByBoma(bomaCode?: string, scope?: DataScope): Promise<ImmunizationDefaulter[]> {
  const defaulters = await getDefaulters(scope);
  if (!bomaCode) return defaulters;
  return defaulters.filter(d => d.facilityName.toLowerCase().includes(bomaCode.toLowerCase()));
}

export async function getDefaulterStats(scope?: DataScope) {
  const defaulters = await getDefaulters(scope);
  const critical = defaulters.filter(d => d.urgency === 'critical').length;
  const high = defaulters.filter(d => d.urgency === 'high').length;
  const medium = defaulters.filter(d => d.urgency === 'medium').length;
  const uniqueChildren = new Set(defaulters.map(d => d.patientId)).size;

  // By vaccine
  const byVaccine: Record<string, number> = {};
  for (const d of defaulters) {
    byVaccine[d.vaccine] = (byVaccine[d.vaccine] || 0) + 1;
  }

  return {
    totalDefaulters: defaulters.length,
    uniqueChildren,
    critical,
    high,
    medium,
    byVaccine,
  };
}

/**
 * Coverage broken down by age cohort. Returns one row per (vaccine × cohort)
 * with the number of children in that cohort who have received the vaccine
 * and the percentage of the cohort. Used by the immunizations dashboard to
 * show whether coverage is concentrated in older children (catching up) or
 * spread evenly through the EPI schedule.
 */
export async function getCoverageByAgeCohort(scope?: DataScope) {
  const all = await getAllImmunizations(scope);
  const completed = all.filter(i => i.status === 'completed');

  // Group children by age cohort based on their most recent dateOfBirth in
  // the records — we treat each unique patientId as a distinct child.
  const childMeta = new Map<string, { dob: string }>();
  for (const r of all) {
    if (!childMeta.has(r.patientId) && r.dateOfBirth) {
      childMeta.set(r.patientId, { dob: r.dateOfBirth });
    }
  }

  const now = Date.now();
  const COHORTS = [
    { key: '<6mo', minMonths: 0, maxMonths: 6 },
    { key: '6-12mo', minMonths: 6, maxMonths: 12 },
    { key: '1-2y', minMonths: 12, maxMonths: 24 },
    { key: '2-5y', minMonths: 24, maxMonths: 60 },
    { key: '5y+', minMonths: 60, maxMonths: Infinity },
  ] as const;

  // Bucket children into cohorts
  const cohortMembers: Record<string, Set<string>> = {};
  for (const c of COHORTS) cohortMembers[c.key] = new Set();
  for (const [patientId, meta] of childMeta.entries()) {
    const ageMonths = (now - new Date(meta.dob).getTime()) / (30.44 * 86400000);
    const cohort = COHORTS.find(c => ageMonths >= c.minMonths && ageMonths < c.maxMonths);
    /* istanbul ignore next -- children outside all cohort ranges are skipped */
    if (cohort) cohortMembers[cohort.key].add(patientId);
  }

  const VACCINES = VACCINE_NAMES;
  const rows: Array<{ vaccine: string; cohort: string; covered: number; total: number; percentage: number }> = [];
  for (const vaccine of VACCINES) {
    const recipients = new Set(completed.filter(i => i.vaccine === vaccine).map(i => i.patientId));
    for (const c of COHORTS) {
      const total = cohortMembers[c.key].size;
      const covered = Array.from(recipients).filter(id => cohortMembers[c.key].has(id)).length;
      rows.push({
        vaccine,
        cohort: c.key,
        covered,
        total,
        percentage: total > 0 ? Math.round((covered / total) * 100) : 0,
      });
    }
  }
  return rows;
}

export async function getVaccineCoverage(scope?: DataScope) {
  const all = await getAllImmunizations(scope);
  const completed = all.filter(i => i.status === 'completed');
  const childIds = new Set(all.map(i => i.patientId));
  const totalChildren = childIds.size;

  const vaccines = VACCINE_NAMES;
  const coverage: { vaccine: string; count: number; percentage: number }[] = [];

  for (const vaccine of vaccines) {
    const childrenWithVaccine = new Set(
      completed.filter(i => i.vaccine === vaccine).map(i => i.patientId)
    );
    coverage.push({
      vaccine,
      count: childrenWithVaccine.size,
      percentage: totalChildren > 0 ? Math.round((childrenWithVaccine.size / totalChildren) * 100) : 0,
    });
  }

  return coverage;
}
