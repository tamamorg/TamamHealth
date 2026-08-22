/**
 * The platform's open-risk queue, derived in one place.
 *
 * `/admin` and `/admin/risk` both answer "what is wrong with this platform
 * right now", and each used to answer it with its own hand-rolled tally: the
 * Risk Center built full rows from six sources, while the dashboard built a
 * shorter list of severities with different rules (the first three audit
 * failures, one entry per suspended tenant, a flat +1 for sync). The two counts
 * could differ for the same platform state, and once risks became resolvable
 * they would have needed the same resolution logic written twice.
 *
 * This module is the single derivation. Both screens pass the same inputs and
 * render the same rows; the dashboard shows a count and a readiness score, the
 * Risk Center shows the queue and the controls to work it.
 */

import { classifyAuditRisk, type SaSeverity } from './sa-ui';
import type { AuditLogDoc, ConflictQueueDoc, OrganizationDoc, SyncEventDoc } from '@/lib/db-types';

export type RiskSource = 'Audit' | 'Sync' | 'Data' | 'Tenants' | 'Continuity' | 'Platform';

export interface RiskRow {
  /** Stable across reloads — the key a resolution is filed under. */
  id: string;
  /**
   * Which *occurrence* this row is.
   *
   * Event-shaped risks (an audit failure, a conflict) carry a document id that
   * never comes back, so the signature is effectively the id. Condition-shaped
   * risks reuse one id each time they occur, so their signature encodes the
   * state that is true now — which is what lets a resolution expire on its own
   * when the condition returns in a different form. See RiskResolutionDoc.
   */
  signature: string;
  severity: SaSeverity;
  signal: string;
  source: RiskSource;
  detail: string;
  when?: string;
  status: string;
}

export interface RiskInputs {
  auditLogs: AuditLogDoc[];
  /** Aggregate failure count from sync stats — the gate for listing backlog. */
  syncFailed: number;
  pendingSyncEvents: SyncEventDoc[];
  conflicts: ConflictQueueDoc[];
  organizations: OrganizationDoc[];
  maintenanceMode: boolean;
  /** Platform config `updatedAt` — the maintenance row's occurrence marker, so
   *  toggling maintenance off and on again reopens rather than staying hidden
   *  behind the resolution of the previous window. */
  configUpdatedAt?: string;
  backupRpoHours?: number;
  /** null = no backup has ever been reported (different from "overdue"). */
  backupAgeHours: number | null;
  backupLastAt?: string | null;
}

export const SEVERITY_ORDER: Record<SaSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Readiness cost of leaving one risk open, by severity. */
export const SEVERITY_WEIGHT: Record<SaSeverity, number> = { critical: 12, high: 8, medium: 5, low: 2 };

/** Failed audit entries older than this are no longer treated as open risk. */
const AUDIT_WINDOW_MS = 7 * 24 * 3600 * 1000;

export function buildRiskRows(input: RiskInputs): RiskRow[] {
  const out: RiskRow[] = [];
  const cutoff = Date.now() - AUDIT_WINDOW_MS;

  // (a) failed audit events, last 7 days
  for (const log of input.auditLogs) {
    if (log.success) continue;
    const t = log.createdAt ? new Date(log.createdAt).getTime() : 0;
    if (!t || t < cutoff) continue;
    out.push({
      id: `audit-${log._id}`,
      signature: log._id,
      severity: classifyAuditRisk(log.action, log.success),
      signal: log.action,
      source: 'Audit',
      detail: log.details || log.username || 'No detail recorded',
      when: log.createdAt,
      status: 'failed',
    });
  }

  // (b) sync backlog — only surfaced once the aggregate stats show a real
  // failure count; rows are the currently pending backlog behind it.
  if (input.syncFailed > 0) {
    for (const ev of input.pendingSyncEvents) {
      out.push({
        id: `sync-${ev._id}`,
        // A queued event that later fails is a new problem, not the one that
        // was resolved, so the state rides in the signature.
        signature: `${ev._id}:${ev.syncStatus}`,
        severity: 'medium',
        signal: `${ev.operation} ${ev.resourceType}`,
        source: 'Sync',
        detail: `${ev.resourceId.slice(0, 24)} · ${ev.syncStatus}`,
        when: ev.occurredAt,
        status: ev.syncStatus,
      });
    }
  }

  // (c) pending conflicts
  for (const c of input.conflicts) {
    if (c.status !== 'pending') continue;
    out.push({
      id: `conflict-${c._id}`,
      signature: c._id,
      severity: c.risk === 'high' ? 'high' : c.risk === 'medium' ? 'medium' : 'low',
      signal: `${c.resourceType} conflict`,
      source: 'Data',
      detail: `${c.losingRevs.length} competing revision${c.losingRevs.length === 1 ? '' : 's'}`,
      when: c.createdAt,
      status: 'pending',
    });
  }

  // (d) tenant risk
  for (const org of input.organizations) {
    if (org.subscriptionStatus === 'suspended' || org.subscriptionStatus === 'cancelled' || !org.isActive) {
      out.push({
        id: `org-status-${org._id}`,
        signature: `${org.subscriptionStatus}:${org.isActive !== false}`,
        severity: 'medium',
        signal: `${org.name} — ${org.subscriptionStatus}`,
        source: 'Tenants',
        detail: org.isActive ? 'Subscription is not active' : 'Organization deactivated',
        when: org.updatedAt,
        status: org.subscriptionStatus,
      });
    } else if (org.subscriptionStatus === 'trial') {
      out.push({
        id: `org-trial-${org._id}`,
        signature: `trial:${org.subscriptionPlan}`,
        severity: 'low',
        signal: `${org.name} — trial`,
        source: 'Tenants',
        detail: `${org.subscriptionPlan} plan on trial subscription`,
        when: org.createdAt,
        status: 'trial',
      });
    }
  }

  // (e) backup missing or overdue against the policy RPO
  const rpo = input.backupRpoHours;
  if (rpo) {
    if (input.backupAgeHours === null) {
      out.push({
        id: 'continuity-backup-missing',
        signature: `missing:${rpo}`,
        severity: 'high',
        signal: 'No backup on record',
        source: 'Continuity',
        detail: `Recovery point objective is ${rpo}h`,
        status: 'unknown',
      });
    } else if (input.backupAgeHours > rpo) {
      out.push({
        id: 'continuity-backup-overdue',
        // Keyed to the backup it is overdue *since*. A newer backup that later
        // goes overdue is a fresh lapse and reopens on its own.
        signature: `${input.backupLastAt || 'none'}:${rpo}`,
        severity: input.backupAgeHours > rpo * 2 ? 'high' : 'medium',
        signal: 'Backup overdue',
        source: 'Continuity',
        detail: `Last backup ${Math.round(input.backupAgeHours)}h ago, RPO is ${rpo}h`,
        status: 'overdue',
      });
    }
  }

  // (f) maintenance mode
  if (input.maintenanceMode) {
    out.push({
      id: 'platform-maintenance',
      signature: `on:${input.configUpdatedAt || 'unknown'}`,
      severity: 'low',
      signal: 'Maintenance mode is on',
      source: 'Platform',
      detail: 'Platform is restricted to admin-only access',
      status: 'on',
    });
  }

  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return out;
}

/**
 * Platform readiness, 0–100, as the cost of everything still open.
 *
 * Previously each screen scored readiness from its own mix of raw counts, which
 * meant resolving a risk in the Risk Center could not move the dashboard donut
 * — the donut was not counting risks, it was counting sources. Scoring the open
 * rows makes the two agree by construction: the number on the dashboard is the
 * queue on the Risk Center page.
 */
export function readinessFromRisks(openRows: RiskRow[]): number {
  const cost = openRows.reduce((sum, r) => sum + SEVERITY_WEIGHT[r.severity], 0);
  return Math.max(0, Math.min(100, 100 - cost));
}
