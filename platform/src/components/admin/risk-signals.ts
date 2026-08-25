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

/**
 * Which RULE produced a row, as opposed to which subsystem it came from.
 *
 * `source` is the six-way grouping an operator filters by; two different rules
 * can share one ("no backup on record" and "backup overdue" are both
 * Continuity, and they mean opposite things). The explanation a reader needs is
 * per rule, so it is keyed by this.
 */
export type RiskKind =
  | 'audit' | 'sync' | 'conflict' | 'org-status' | 'org-trial'
  | 'backup-missing' | 'backup-overdue' | 'maintenance';

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
  /** The rule behind the row — the key its explanation is filed under. */
  kind: RiskKind;
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

/** A single noisy subsystem can lower readiness by at most this many points. */
export const READINESS_SOURCE_CAP = 30;

/** Controls how quickly repeated risks from one source approach the cap. */
const READINESS_CURVE_SCALE = 26;

/** Failed audit entries older than this are no longer treated as open risk. */
const AUDIT_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * What a row MEANS, in the words an operator needs at the moment they are
 * deciding what to do about it.
 *
 * A derived queue states a condition — "No backup on record", "3 competing
 * revisions" — and says nothing about what asserts it, what usually causes it,
 * or what makes it go away. That gap is what turns a HIGH row into a button
 * somebody presses to make the red thing stop: resolving records that a risk
 * was dealt with, so an operator who resolves one they do not understand has
 * quietly told every other operator it was handled.
 *
 * The copy itself lives in the locales (`riskGuide.*`), because this is the
 * only part of the Risk Center a reader is meant to READ rather than scan, and
 * a half-translated explanation is worse than an untranslated one. What stays
 * here, beside the rules in `buildRiskRows`, is the mapping from rule to
 * explanation — a rule and its explanation drifting apart is worse than either
 * being missing. Tests assert every kind is covered and every key exists.
 */
export interface RiskGuidance {
  /** One or two sentences: what the platform is actually asserting. */
  meansKey: string;
  /** The usual causes, most likely first. Kept to three — this is a dialog. */
  causeKeys: readonly string[];
  /** What makes the row go away for real, as opposed to resolving it. */
  clearsKey: string;
}

const guide = (kind: RiskKind, causes: number): RiskGuidance => ({
  meansKey: `riskGuide.${kind}.means`,
  causeKeys: Array.from({ length: causes }, (_, i) => `riskGuide.${kind}.cause${i + 1}`),
  clearsKey: `riskGuide.${kind}.clears`,
});

export const RISK_GUIDANCE: Record<RiskKind, RiskGuidance> = {
  audit: guide('audit', 2),
  sync: guide('sync', 2),
  conflict: guide('conflict', 1),
  'org-status': guide('org-status', 2),
  'org-trial': guide('org-trial', 1),
  'backup-missing': guide('backup-missing', 3),
  'backup-overdue': guide('backup-overdue', 2),
  maintenance: guide('maintenance', 1),
};

/** The explanation for a row, by the rule that produced it. */
export function riskGuidance(row: Pick<RiskRow, 'kind'>): RiskGuidance | undefined {
  return RISK_GUIDANCE[row.kind];
}

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
      kind: 'audit',
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
        kind: 'sync',
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
      kind: 'conflict',
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
        kind: 'org-status',
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
        kind: 'org-trial',
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
        kind: 'backup-missing',
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
        kind: 'backup-overdue',
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
      kind: 'maintenance',
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
 * Platform readiness, 0–100, as the cost of the subsystems with open risk.
 *
 * Previously each screen scored readiness from its own mix of raw counts, which
 * meant resolving a risk in the Risk Center could not move the dashboard donut
 * — the donut was not counting risks, it was counting sources. Scoring the open
 * rows makes the two agree by construction: the number on the dashboard is the
 * queue on the Risk Center page. Within each source, repeated rows have
 * diminishing impact and a hard cap. This keeps a large conflict backlog
 * visible without allowing it to erase otherwise healthy independent signals.
 */
export function readinessFromRisks(openRows: RiskRow[]): number {
  const weightedBySource = new Map<RiskSource, number>();
  for (const row of openRows) {
    weightedBySource.set(
      row.source,
      (weightedBySource.get(row.source) ?? 0) + SEVERITY_WEIGHT[row.severity]
    );
  }

  const cost = Array.from(weightedBySource.values()).reduce((sum, sourceWeight) => {
    const curved = READINESS_SOURCE_CAP * (1 - Math.exp(-sourceWeight / READINESS_CURVE_SCALE));
    return sum + Math.min(READINESS_SOURCE_CAP, Math.round(curved));
  }, 0);
  return Math.max(0, Math.min(100, 100 - cost));
}
