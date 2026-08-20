/**
 * Emergency Preparedness Service
 *
 * Manages emergency response plans for South Sudan health facilities.
 * Covers disease outbreaks (cholera, measles, Ebola), floods, conflict
 * displacement, famine, and mass casualty events — all common in the
 * South Sudan context.
 *
 * Key features:
 *  - Plan creation, activation, and deactivation lifecycle
 *  - Resource readiness tracking (surge beds, ORS, PPE, cholera cots)
 *  - Communication chain management
 *  - Capacity load monitoring and surge alerts
 *  - Cross-facility emergency dashboard
 */
import { emergencyPlansDB } from '../db';
import type { EmergencyPlanDoc, EmergencyPhase, EmergencySeverity } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

// ===== CRUD =====

export async function getAllPlans(scope?: DataScope): Promise<EmergencyPlanDoc[]> {
  const db = emergencyPlansDB();
  const all = (await findByType<EmergencyPlanDoc>(db, 'emergency_plan'))
    .sort((a, b) => {
      // Active emergencies first, then by severity (level_3 > level_2 > level_1)
      const phaseOrder: Record<string, number> = { response: 0, alert: 1, recovery: 2, preparedness: 3, closed: 4 };
      /* istanbul ignore next -- defensive: ?? fallback for unknown phases/severities */
      const phaseDiff = (phaseOrder[a.phase] ?? 5) - (phaseOrder[b.phase] ?? 5);
      if (phaseDiff !== 0) return phaseDiff;
      const sevOrder: Record<string, number> = { level_3: 0, level_2: 1, level_1: 2 };
      /* istanbul ignore next -- defensive: ?? fallback for unknown severity */
      return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
    });
  return scope ? filterByScope(all, scope) : all;
}

export async function getActivePlans(facilityId?: string, scope?: DataScope): Promise<EmergencyPlanDoc[]> {
  const all = await getAllPlans(scope);
  return all.filter(p =>
    (p.phase === 'alert' || p.phase === 'response') &&
    (!facilityId || p.facilityId === facilityId)
  );
}

export async function getPlanById(id: string, scope?: DataScope): Promise<EmergencyPlanDoc | null> {
  const db = emergencyPlansDB();
  try {
    const plan = await db.get(id) as EmergencyPlanDoc;
    return scope && filterByScope([plan], scope).length === 0 ? null : plan;
  } catch {
    return null;
  }
}

export async function createPlan(
  data: Omit<EmergencyPlanDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<EmergencyPlanDoc> {
  const db = emergencyPlansDB();
  const now = new Date().toISOString();

  const doc: EmergencyPlanDoc = {
    _id: `emerg-${uuidv4()}`,
    type: 'emergency_plan',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_EMERGENCY_PLAN', undefined, undefined,
    `Emergency plan ${doc._id}: ${data.planName} (${data.emergencyType}, ${data.severity}) at ${data.facilityName}`
  );
  emitSyncEvent({
    resourceType: 'emergency_plan',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updatePlan(
  id: string,
  updates: Partial<EmergencyPlanDoc>,
  scope?: DataScope,
): Promise<EmergencyPlanDoc | null> {
  const db = emergencyPlansDB();
  try {
    const existing = await db.get(id) as EmergencyPlanDoc;
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
    await logAuditSafe('UPDATE_EMERGENCY_PLAN', undefined, undefined, `Emergency plan ${id} updated`);
    emitSyncEvent({
      resourceType: 'emergency_plan',
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

export async function deletePlan(id: string, scope?: DataScope): Promise<boolean> {
  const db = emergencyPlansDB();
  try {
    const existing = await db.get(id);
    if (scope && filterByScope([existing as EmergencyPlanDoc], scope).length === 0) return false;
    /* istanbul ignore next -- PouchDB always returns _rev on successful get() */
    if (!existing._rev) throw new Error('Missing revision');
    await db.remove(existing._id, existing._rev);
    await logAuditSafe('DELETE_EMERGENCY_PLAN', undefined, undefined, `Emergency plan ${id} deleted`);
    emitSyncEvent({
      resourceType: 'emergency_plan',
      resourceId: id,
      operation: 'delete',
      orgId: (existing as EmergencyPlanDoc).orgId,
      hospitalId: (existing as EmergencyPlanDoc).facilityId,
    });
    return true;
  } catch {
    return false;
  }
}

// ===== Lifecycle =====

export async function activatePlan(
  id: string,
  activatedBy: string,
  severity?: EmergencySeverity,
  scope?: DataScope,
): Promise<EmergencyPlanDoc | null> {
  const plan = await getPlanById(id, scope);
  if (!plan) return null;
  if (plan.phase === 'response') return plan; // Already active

  const updates: Partial<EmergencyPlanDoc> = {
    phase: 'response',
    activatedAt: new Date().toISOString(),
    activatedBy,
  };
  if (severity) updates.severity = severity;

  const result = await updatePlan(id, updates, scope);
  /* istanbul ignore next -- updatePlan only returns null if doc is missing, already checked above */
  if (result) {
    await logAuditSafe('ACTIVATE_EMERGENCY', activatedBy, undefined,
      `EMERGENCY ACTIVATED: ${plan.planName} (${plan.emergencyType}) at ${plan.facilityName} — severity ${severity || plan.severity}`
    );
  }
  return result;
}

export async function deactivatePlan(
  id: string,
  deactivatedBy: string,
  scope?: DataScope,
): Promise<EmergencyPlanDoc | null> {
  const plan = await getPlanById(id, scope);
  if (!plan) return null;
  if (plan.phase === 'closed') return plan; // Already closed

  const result = await updatePlan(id, {
    phase: 'recovery',
    deactivatedAt: new Date().toISOString(),
  }, scope);
  /* istanbul ignore next -- updatePlan only returns null if doc is missing, already checked above */
  if (result) {
    await logAuditSafe('DEACTIVATE_EMERGENCY', deactivatedBy, undefined,
      `Emergency deactivated: ${plan.planName} at ${plan.facilityName} — moving to recovery phase`
    );
  }
  return result;
}

export async function closePlan(id: string, scope?: DataScope): Promise<EmergencyPlanDoc | null> {
  return updatePlan(id, { phase: 'closed' }, scope);
}

// ===== Resource & Capacity Monitoring =====

export interface SurgeAlert {
  planId: string;
  planName: string;
  facilityName: string;
  emergencyType: string;
  severity: EmergencySeverity;
  alertType: 'capacity_critical' | 'beds_exhausted' | 'supplies_low' | 'ppe_low';
  message: string;
  urgency: 'critical' | 'high' | 'medium';
}

export async function getSurgeAlerts(facilityId?: string, scope?: DataScope): Promise<SurgeAlert[]> {
  const active = await getActivePlans(facilityId, scope);
  const alerts: SurgeAlert[] = [];

  for (const plan of active) {
    const loadPct = plan.estimatedCapacity > 0
      ? (plan.currentLoad / plan.estimatedCapacity) * 100
      : 0;

    if (loadPct >= 100) {
      alerts.push({
        planId: plan._id,
        planName: plan.planName,
        facilityName: plan.facilityName,
        emergencyType: plan.emergencyType,
        severity: plan.severity,
        alertType: 'capacity_critical',
        message: `${plan.facilityName} has exceeded emergency capacity (${plan.currentLoad}/${plan.estimatedCapacity} patients)`,
        urgency: 'critical',
      });
    }

    if (plan.resources.availableSurgeBeds <= 0) {
      alerts.push({
        planId: plan._id,
        planName: plan.planName,
        facilityName: plan.facilityName,
        emergencyType: plan.emergencyType,
        severity: plan.severity,
        alertType: 'beds_exhausted',
        message: `${plan.facilityName} has zero available surge beds`,
        urgency: 'critical',
      });
    }

    if (plan.resources.oralRehydrationSachets < 50 && (plan.emergencyType === 'cholera_outbreak' || plan.emergencyType === 'disease_outbreak')) {
      alerts.push({
        planId: plan._id,
        planName: plan.planName,
        facilityName: plan.facilityName,
        emergencyType: plan.emergencyType,
        severity: plan.severity,
        alertType: 'supplies_low',
        message: `${plan.facilityName} is running low on ORS sachets (${plan.resources.oralRehydrationSachets} remaining)`,
        urgency: 'high',
      });
    }

    if (plan.resources.ppe < 20) {
      alerts.push({
        planId: plan._id,
        planName: plan.planName,
        facilityName: plan.facilityName,
        emergencyType: plan.emergencyType,
        severity: plan.severity,
        alertType: 'ppe_low',
        message: `${plan.facilityName} is running low on PPE sets (${plan.resources.ppe} remaining)`,
        urgency: plan.resources.ppe < 5 ? 'critical' : 'high',
      });
    }
  }

  // Sort: critical first, then high, then medium
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  /* istanbul ignore next -- defensive: ?? fallback for unknown urgency */
  return alerts.sort((a, b) => (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3));
}

// ===== Dashboard Summary =====

export interface EmergencyDashboard {
  activePlans: number;
  totalPlans: number;
  byPhase: Record<EmergencyPhase, number>;
  bySeverity: Record<EmergencySeverity, number>;
  byType: Record<string, number>;
  totalCasesManaged: number;
  totalDeaths: number;
  totalReferralsOut: number;
  surgeAlerts: SurgeAlert[];
}

export async function getEmergencyDashboard(facilityId?: string, scope?: DataScope): Promise<EmergencyDashboard> {
  const all = await getAllPlans(scope);
  const filtered = facilityId ? all.filter(p => p.facilityId === facilityId) : all;

  const byPhase = { preparedness: 0, alert: 0, response: 0, recovery: 0, closed: 0 };
  const bySeverity = { level_1: 0, level_2: 0, level_3: 0 };
  const byType: Record<string, number> = {};
  let totalCases = 0;
  let totalDeaths = 0;
  let totalReferrals = 0;

  for (const plan of filtered) {
    byPhase[plan.phase] = (byPhase[plan.phase] || 0) + 1;
    bySeverity[plan.severity] = (bySeverity[plan.severity] || 0) + 1;
    byType[plan.emergencyType] = (byType[plan.emergencyType] || 0) + 1;
    totalCases += plan.totalCasesManaged || 0;
    totalDeaths += plan.totalDeaths || 0;
    totalReferrals += plan.totalReferralsOut || 0;
  }

  const surgeAlerts = await getSurgeAlerts(facilityId, scope);

  return {
    activePlans: filtered.filter(p => p.phase === 'alert' || p.phase === 'response').length,
    totalPlans: filtered.length,
    byPhase,
    bySeverity,
    byType,
    totalCasesManaged: totalCases,
    totalDeaths,
    totalReferralsOut: totalReferrals,
    surgeAlerts,
  };
}
