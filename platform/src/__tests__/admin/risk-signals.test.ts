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
  buildRiskRows, readinessFromRisks, riskGuidance, READINESS_SOURCE_CAP, RISK_GUIDANCE,
  SEVERITY_WEIGHT, type RiskInputs, type RiskKind,
} from '@/components/admin/risk-signals';
import { indexResolutions, isRiskResolved } from '@/lib/services/risk-resolution-service';
import en from '@/lib/i18n/locales/en';
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

  test('a noisy source has diminishing impact and cannot erase every other signal', () => {
    const many = Array.from({ length: 40 }, (_, i) => auditFailure(`a${i}`, 'login_failed', HOUR));
    expect(readinessFromRisks(buildRiskRows({ ...emptyInputs(), auditLogs: many }))).toBe(100 - READINESS_SOURCE_CAP);
  });

  test('independent risk sources still accumulate', () => {
    const rows = buildRiskRows({
      ...emptyInputs(),
      auditLogs: Array.from({ length: 40 }, (_, i) => auditFailure(`a${i}`, 'login_failed', HOUR)),
      organizations: [org('o1', { subscriptionStatus: 'trial' })],
      backupRpoHours: 24,
      backupAgeHours: null,
    });
    expect(readinessFromRisks(rows)).toBe(60);
  });
});

/**
 * Every row must be able to explain itself.
 *
 * The queue's rows are conditions with a severity — "No backup on record",
 * HIGH — and the only control on them is Resolve, which tells every other
 * operator the risk was handled. A row nobody can read is therefore not a
 * missing tooltip; it is a button pressed to make a red thing stop. These
 * assert the explanation exists for every rule, including the next one
 * somebody adds, and that every key it names is real copy rather than a key
 * echoed back at the reader.
 */
describe('risk guidance', () => {
  const ALL_KINDS: RiskKind[] = [
    'audit', 'sync', 'conflict', 'org-status', 'org-trial',
    'backup-missing', 'backup-overdue', 'maintenance',
  ];

  test('the guidance map covers exactly the kinds that exist', () => {
    expect(Object.keys(RISK_GUIDANCE).sort()).toEqual([...ALL_KINDS].sort());
  });

  test('every kind names a meaning, at least one cause, and a way to clear it', () => {
    for (const kind of ALL_KINDS) {
      const guidance = RISK_GUIDANCE[kind];
      expect(guidance.meansKey).toBe(`riskGuide.${kind}.means`);
      expect(guidance.clearsKey).toBe(`riskGuide.${kind}.clears`);
      expect(guidance.causeKeys.length).toBeGreaterThan(0);
      // Three is the dialog's limit; a fourth cause means the explanation has
      // become a runbook and belongs in the docs it should link to instead.
      expect(guidance.causeKeys.length).toBeLessThanOrEqual(3);
    }
  });

  test('every key it names exists in the locale', () => {
    // A missing key renders as the key itself — "riskGuide.sync.means" in the
    // middle of a sentence — which is how a translation gap reaches an
    // operator looking at a HIGH row.
    for (const kind of ALL_KINDS) {
      const { meansKey, causeKeys, clearsKey } = RISK_GUIDANCE[kind];
      const copy = (key: string) => en[key as keyof typeof en] as string | undefined;
      for (const key of [meansKey, ...causeKeys, clearsKey]) {
        expect(typeof copy(key)).toBe('string');
        // A sentence, not a placeholder. Causes are allowed to be terse
        // ("Billing lapsed."); the two prose fields are not.
        expect(copy(key)!.trim().length).toBeGreaterThan(10);
      }
      expect(copy(meansKey)!.length).toBeGreaterThan(40);
      expect(copy(clearsKey)!.length).toBeGreaterThan(30);
    }
    for (const head of ['meansHead', 'causeHead', 'causesHead', 'clearsHead']) {
      expect(typeof en[`riskGuide.${head}` as keyof typeof en]).toBe('string');
    }
  });

  test('a built row resolves to its own explanation', () => {
    // The two Continuity rules share a source and mean opposite things, so the
    // lookup has to key on the rule rather than on `source`.
    const [missing] = buildRiskRows({ ...emptyInputs(), backupRpoHours: 24, backupAgeHours: null });
    const [overdue] = buildRiskRows({ ...emptyInputs(), backupRpoHours: 24, backupAgeHours: 30 });
    expect(missing.kind).toBe('backup-missing');
    expect(overdue.kind).toBe('backup-overdue');
    expect(riskGuidance(missing)).toBe(RISK_GUIDANCE['backup-missing']);
    expect(riskGuidance(overdue)).not.toBe(riskGuidance(missing));
  });

  test('the no-backup explanation says what it is actually asserting', () => {
    // The row reads as "backups are failing". It is not that — it is "nothing
    // reported one", and an operator who reads it the first way resolves it.
    const means = en['riskGuide.backup-missing.means'];
    expect(means).toMatch(/RECORD of a backup/);
    expect(means).toMatch(/not evidence that backing up failed/);
  });
});
