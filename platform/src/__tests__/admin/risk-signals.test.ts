/**
 * The platform risk queue and the resolutions that clear it.
 *
 * Two behaviours here are worth a test because getting them wrong is silent
 * rather than loud:
 *
 *   1. `/admin` and `/admin/risk` must derive the SAME rows. They used to keep
 *      two hand-rolled tallies, so one screen could report four open risks
 *      while the other scored readiness as if there were none.
 *   2. A resolution must clear the occurrence it was filed against and
 *      nothing else. If the signature check is dropped, a resolution written
 *      weeks ago silently suppresses a fresh recurrence of the same condition
 *      — a risk queue that hides risks, which is worse than no queue.
 */

import {
  buildRiskRows, readinessFromRisks, SEVERITY_WEIGHT, type RiskInputs,
} from '@/components/admin/risk-signals';
import { indexResolutions, isRiskResolved } from '@/lib/services/risk-resolution-service';
import type { AuditLogDoc, OrganizationDoc, RiskResolutionDoc } from '@/lib/db-types';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function emptyInputs(): RiskInputs {
  return {
    auditLogs: [],
    syncFailed: 0,
    pendingSyncEvents: [],
    conflicts: [],
    organizations: [],
    maintenanceMode: false,
    backupAgeHours: null,
  };
}

function auditFailure(id: string, action: string, msAgo: number): AuditLogDoc {
  return {
    _id: id,
    type: 'audit_log',
    action,
    success: false,
    createdAt: iso(msAgo),
    updatedAt: iso(msAgo),
  } as unknown as AuditLogDoc;
}

function org(id: string, over: Partial<OrganizationDoc>): OrganizationDoc {
  return {
    _id: id,
    type: 'organization',
    name: `Org ${id}`,
    isActive: true,
    subscriptionStatus: 'active',
    subscriptionPlan: 'professional',
    createdAt: iso(30 * DAY),
    updatedAt: iso(DAY),
    ...over,
  } as unknown as OrganizationDoc;
}

function resolution(riskId: string, signature: string): RiskResolutionDoc {
  return {
    _id: `risk-resolution:${riskId}`,
    type: 'risk_resolution',
    riskId,
    signature,
    severity: 'high',
    source: 'Audit',
    signal: 'whatever',
    resolvedAt: iso(HOUR),
    createdAt: iso(HOUR),
    updatedAt: iso(HOUR),
  };
}

describe('buildRiskRows', () => {
  test('a recent failed audit event becomes one row; an old one does not', () => {
    const rows = buildRiskRows({
      ...emptyInputs(),
      auditLogs: [
        auditFailure('a1', 'login_failed', 2 * DAY),
        auditFailure('a2', 'login_failed', 30 * DAY),
      ],
    });
    expect(rows.map(r => r.id)).toEqual(['audit-a1']);
  });

  test('successful audit events are never risks', () => {
    const ok = { ...auditFailure('a3', 'login_success', HOUR), success: true } as AuditLogDoc;
    expect(buildRiskRows({ ...emptyInputs(), auditLogs: [ok] })).toHaveLength(0);
  });

  test('sync backlog is only listed once the aggregate failure count is real', () => {
    const event = {
      _id: 's1', type: 'sync_event', resourceType: 'patient', resourceId: 'p1',
      operation: 'update', occurredAt: iso(HOUR), syncStatus: 'pending',
      createdAt: iso(HOUR), updatedAt: iso(HOUR),
    } as unknown as RiskInputs['pendingSyncEvents'][number];

    expect(buildRiskRows({ ...emptyInputs(), syncFailed: 0, pendingSyncEvents: [event] })).toHaveLength(0);
    expect(buildRiskRows({ ...emptyInputs(), syncFailed: 1, pendingSyncEvents: [event] })).toHaveLength(1);
  });

  test('suspended and trial tenants are different severities', () => {
    const rows = buildRiskRows({
      ...emptyInputs(),
      organizations: [
        org('o1', { subscriptionStatus: 'suspended' }),
        org('o2', { subscriptionStatus: 'trial' }),
        org('o3', { subscriptionStatus: 'active' }),
      ],
    });
    expect(rows.map(r => [r.id, r.severity])).toEqual([
      ['org-status-o1', 'medium'],
      ['org-trial-o2', 'low'],
    ]);
  });

  test('no backup on record and an overdue backup are distinct rows', () => {
    const missing = buildRiskRows({ ...emptyInputs(), backupRpoHours: 24, backupAgeHours: null });
    expect(missing.map(r => r.id)).toEqual(['continuity-backup-missing']);

    const overdue = buildRiskRows({ ...emptyInputs(), backupRpoHours: 24, backupAgeHours: 30 });
    expect(overdue.map(r => r.id)).toEqual(['continuity-backup-overdue']);

    // Inside the RPO is not a risk at all.
    expect(buildRiskRows({ ...emptyInputs(), backupRpoHours: 24, backupAgeHours: 5 })).toHaveLength(0);
  });

  test('rows come back worst-first', () => {
    const rows = buildRiskRows({
      ...emptyInputs(),
      organizations: [org('o1', { subscriptionStatus: 'trial' }), org('o2', { subscriptionStatus: 'suspended' })],
      backupRpoHours: 24,
      backupAgeHours: null,
    });
    expect(rows.map(r => r.severity)).toEqual(['high', 'medium', 'low']);
  });
});

describe('resolutions', () => {
  test('a resolution clears the occurrence it was filed against', () => {
    const rows = buildRiskRows({ ...emptyInputs(), auditLogs: [auditFailure('a1', 'login_failed', HOUR)] });
    const [row] = rows;
    const index = indexResolutions([resolution(row.id, row.signature)]);
    expect(isRiskResolved(index, row.id, row.signature)).toBe(true);
  });

  test('it does not clear a different occurrence of the same condition', () => {
    // The backup risk reuses one id every time it happens, so only the
    // signature can tell one lapse from the next.
    const first = buildRiskRows({
      ...emptyInputs(), backupRpoHours: 24, backupAgeHours: 30, backupLastAt: iso(30 * HOUR),
    })[0];
    const index = indexResolutions([resolution(first.id, first.signature)]);
    expect(isRiskResolved(index, first.id, first.signature)).toBe(true);

    // A backup ran, then the platform fell behind again: same row id, new lapse.
    const second = buildRiskRows({
      ...emptyInputs(), backupRpoHours: 24, backupAgeHours: 26, backupLastAt: iso(26 * HOUR),
    })[0];
    expect(second.id).toBe(first.id);
    expect(isRiskResolved(index, second.id, second.signature)).toBe(false);
  });

  test('maintenance mode reopens after being switched off and on again', () => {
    const on = buildRiskRows({ ...emptyInputs(), maintenanceMode: true, configUpdatedAt: iso(2 * HOUR) })[0];
    const index = indexResolutions([resolution(on.id, on.signature)]);
    expect(isRiskResolved(index, on.id, on.signature)).toBe(true);

    const again = buildRiskRows({ ...emptyInputs(), maintenanceMode: true, configUpdatedAt: iso(HOUR) })[0];
    expect(isRiskResolved(index, again.id, again.signature)).toBe(false);
  });

  test('an unrelated risk is untouched', () => {
    const index = indexResolutions([resolution('audit-a1', 'a1')]);
    expect(isRiskResolved(index, 'audit-a2', 'a2')).toBe(false);
  });
});

describe('readinessFromRisks', () => {
  test('a clean platform is 100', () => {
    expect(readinessFromRisks([])).toBe(100);
  });

  test('each open risk costs its severity weight', () => {
    const rows = buildRiskRows({
      ...emptyInputs(),
      auditLogs: [auditFailure('a1', 'login_failed', HOUR)],   // high
      organizations: [org('o1', { subscriptionStatus: 'trial' })], // low
    });
    expect(readinessFromRisks(rows)).toBe(100 - SEVERITY_WEIGHT.high - SEVERITY_WEIGHT.low);
  });

  test('it floors at zero rather than going negative', () => {
    const many = Array.from({ length: 40 }, (_, i) => auditFailure(`a${i}`, 'login_failed', HOUR));
    expect(readinessFromRisks(buildRiskRows({ ...emptyInputs(), auditLogs: many }))).toBe(0);
  });
});
