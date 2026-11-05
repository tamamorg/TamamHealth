'use client';

/**
 * Super-admin → Security & Compliance.
 * Edits config.superAdminPolicies (defaults ⊕ persisted overrides, from the
 * shared `DEFAULT_POLICIES` module) through the Settings-design two-pane
 * shell (`SadbShell`). Edits accumulate in local draft state — nothing
 * reaches the server until "Save changes" — and a dirty-guard keeps a
 * background config refresh from clobbering an in-progress edit.
 * The overview posture list and continuity backup-age row read the actual
 * *persisted* policy (not the draft), and derive an honest three-way backup
 * signal (KAN-117): "unknown" must not read as "at risk".
 *
 * The Security watchlist section is the home of the high-risk-action list the
 * super-admin dashboard used to carry: the same 7-day window and the same
 * `classifyAuditRisk` severity, read live from the audit store, with every row
 * opening its full entry in Audit Logs.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useToast } from '@/components/Toast';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { useBackupStatus } from '@/lib/hooks/useBackupStatus';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AuditLogDoc, PlatformConfigDoc } from '@/lib/db-types';
import { DEFAULT_POLICIES } from '@/lib/admin/super-admin-policies';
import { Lock, FileText, AlertTriangle, Clock, ShieldCheck, Eye } from '@/components/icons/lucide';
import { classifyAuditRisk, formatWhen, type SaSeverity } from '@/components/admin/sa-ui';
import { useNow } from '@/lib/hooks/useNow';
import {
  SadbPage, SadbShell, useSadbTab, SadbPanelHeader, SadbSettingGroup, SadbSettingRow,
  SadbToggle, SadbValueButton, SadbEditorModal, SadbCard, SadbKvRow,
  SadbQueueRow, SadbSaveBar, SEVERITY_CHIP, TONE_CHIP, type Tone,
} from '@/components/admin/sadb-ui';
import { describeError } from '@/lib/user-facing-error';

const SEVERITY_KEY: Record<SaSeverity, string> = {
  critical: 'admin.healthCritical',
  high: 'epidemic.severityHigh',
  medium: 'syncConflicts.riskFilter_medium',
  low: 'epidemic.severityLow',
};

type Policy = NonNullable<PlatformConfigDoc['superAdminPolicies']>;

/**
 * Whether the platform actually DOES anything with a setting.
 *
 * This screen shipped with sixteen controls and enforced none of them. An
 * operator reading it believed the platform imposed a requirement, a
 * password minimum, an idle timeout and a cap on support sessions; the code
 * read none of those values, and a governance screen that overstates the
 * posture will be read as an assurance by whoever procures and audits it.
 *
 * Four are enforced now. The rest are real commitments an organisation makes
 * and answers for — an audit-retention window, a recovery objective, a rule
 * that destructive actions get a second approver — but the platform does not
 * police them, and saying so on the row is the difference between a policy
 * register and a false claim.
 */
type Enforcement = 'enforced' | 'recorded';

interface SettingField {
  kind: 'toggle' | 'number';
  key: keyof Policy;
  /** Defaults to 'recorded' — a control has to EARN the stronger label. */
  enforcement?: Enforcement;
  /** What enforces it, named so the claim is checkable. */
  enforcedBy?: string;
  /** Translation keys, resolved with t() where the row is drawn. */
  label: string;
  sub: string;
  /** Appended straight after the value, e.g. "15m", "6y", " characters". */
  unit?: string;
}

const ACCESS_FIELDS: SettingField[] = [
  {
    kind: 'number', key: 'passwordMinLength', label: 'adminMgmt.secPasswordMin', sub: 'adminMgmt.secPasswordMinSub',
    unit: ' characters', enforcement: 'enforced', enforcedBy: 'lib/password-policy.ts',
  },
  {
    kind: 'number', key: 'sessionTimeoutMinutes', label: 'ui.sessionTimeout', sub: 'adminMgmt.secSessionTimeoutSub',
    unit: 'm', enforcement: 'enforced', enforcedBy: 'lib/hooks/useAutoLock.ts',
  },
  {
    kind: 'toggle', key: 'screenLockRequired', label: 'adminSecurity.screenLockMandatory', sub: 'adminSecurity.screenLockMandatorySub',
    enforcement: 'enforced', enforcedBy: 'lib/hooks/useAutoLock.ts',
  },
  { kind: 'toggle', key: 'ssoEnabled', label: 'adminMgmt.singleSignOn', sub: 'adminMgmt.secSsoSub' },
];

const PHI_FIELDS: SettingField[] = [
  { kind: 'toggle', key: 'phiExportRequiresReason', label: 'adminMgmt.secPhiExport', sub: 'adminMgmt.secPhiExportSub' },
  { kind: 'toggle', key: 'dataDeletionRequiresApproval', label: 'adminMgmt.secDeletionApproval', sub: 'adminMgmt.secDeletionApprovalSub' },
  { kind: 'number', key: 'auditRetentionYears', label: 'ui.auditRetention', sub: 'adminMgmt.secAuditRetentionSub', unit: 'y' },
  { kind: 'toggle', key: 'apiKeysEnabled', label: 'adminMgmt.apiKeys', sub: 'adminMgmt.secApiKeysSub' },
];

const BREAKGLASS_FIELDS: SettingField[] = [
  { kind: 'toggle', key: 'emergencyAccessEnabled', label: 'adminMgmt.secEmergencyAccess', sub: 'adminMgmt.secEmergencyAccessSub' },
  { kind: 'number', key: 'emergencyAccessReviewHours', label: 'adminMgmt.secEmergencyReview', sub: 'adminMgmt.secEmergencyReviewSub', unit: 'h' },
  {
    kind: 'toggle', key: 'impersonationEnabled', label: 'adminMgmt.secImpersonate',
    sub: 'adminMgmt.secImpersonateSub',
    enforcement: 'enforced', enforcedBy: 'lib/login-session.ts',
  },
  {
    kind: 'number', key: 'impersonationMaxMinutes', label: 'adminMgmt.secImpersonateMax',
    sub: 'adminMgmt.secImpersonateMaxSub',
    unit: 'm', enforcement: 'enforced', enforcedBy: 'lib/login-session.ts',
  },
  { kind: 'toggle', key: 'supportAccessRequiresTicket', label: 'adminMgmt.secSupportTicket', sub: 'adminMgmt.secSupportTicketSub' },
  { kind: 'toggle', key: 'dualApprovalForHighRisk', label: 'adminMgmt.secDualApproval', sub: 'adminMgmt.secDualApprovalSub' },
];

const CONTINUITY_FIELDS: SettingField[] = [
  { kind: 'number', key: 'backupRpoHours', label: 'adminMgmt.secDataLossLimit', sub: 'adminMgmt.secDataLossLimitSub', unit: 'h' },
  { kind: 'number', key: 'backupRtoHours', label: 'adminMgmt.secRestoreLimit', sub: 'adminMgmt.secRestoreLimitSub', unit: 'h' },
];

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The row's description, with what the platform will actually do about it.
 *
 * Appended rather than shown as a chip so it survives every surface that reads
 * `sub` — including /admin/config, which lists the same policy values.
 */
function enforcementSub(f: SettingField, t: Translate): string {
  return t(f.enforcement === 'enforced' ? 'adminMgmt.secEnforced' : 'adminMgmt.secRecorded', { sub: t(f.sub) });
}

function formatValue(f: SettingField, value: number): string {
  return `${value}${f.unit ?? ''}`;
}

function renderField(f: SettingField, draft: Policy, onToggle: (key: keyof Policy, value: boolean) => void, onEditNumber: (f: SettingField) => void, t: Translate) {
  if (f.kind === 'toggle') {
    return (
      <SadbSettingRow key={f.key} label={t(f.label)} sub={enforcementSub(f, t)}>
        <SadbToggle checked={Boolean(draft[f.key])} onChange={v => onToggle(f.key, v)} label={t(f.label)} />
      </SadbSettingRow>
    );
  }
  return (
    <SadbSettingRow key={f.key} label={t(f.label)} sub={enforcementSub(f, t)}>
      <SadbValueButton value={formatValue(f, draft[f.key] as number)} onClick={() => onEditNumber(f)} title={t('adminMgmt.secEditField', { label: t(f.label).toLowerCase() })} />
    </SadbSettingRow>
  );
}

export default function SecurityCompliancePage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { config, update } = usePlatformConfig();
  const [backupAgeHours, setBackupAgeHours] = useState<number | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);

  const [activeSection, setActiveSection] = useSadbTab('access');

  // Single source (KAN-117) — this used to read a localStorage key nothing
  // wrote, so "backupWithinRpo" was permanently false and reported as if
  // measured.
  const backupStatus = useBackupStatus();
  useEffect(() => {
    if (backupStatus?.ageHours != null) setBackupAgeHours(backupStatus.ageHours);
  }, [backupStatus]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getRecentAuditLogs } = await import('@/lib/services/audit-service');
        const logs = await getRecentAuditLogs(500, scope);
        if (mounted) setAuditLogs(logs);
      } catch (err) {
        console.error('Failed to load the security watchlist:', err);
      } finally {
        if (mounted) setAuditLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [scope]);

  /* Watchlist — medium risk and above, last 7 days, worst first. Same window
     and same classifier the Risk Center and Audit Logs use. */
  const now = useNow();
  const watchlist = useMemo(() => {
    const cutoff = now - 7 * 24 * 3600 * 1000;
    const order: SaSeverity[] = ['critical', 'high', 'medium', 'low'];
    return auditLogs
      .map(log => ({ log, severity: classifyAuditRisk(log.action, log.success) }))
      .filter(({ log, severity }) =>
        severity !== 'low'
        && log.createdAt
        && new Date(log.createdAt).getTime() >= cutoff)
      .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)
        || new Date(b.log.createdAt).getTime() - new Date(a.log.createdAt).getTime())
      .slice(0, 25);
  }, [auditLogs, now]);

  // Three-way, not boolean: "unknown" must not read as "not within RPO".
  const backupWithinRpo = backupStatus?.state === 'ok';
  const backupUnknown = backupStatus == null || backupStatus.state === 'unknown';

  /* ── Persisted policy (source of truth) vs. local draft ────────────── */

  const persisted: Policy = useMemo(
    () => ({ ...DEFAULT_POLICIES, ...(config?.superAdminPolicies || {}) }),
    [config],
  );

  const [draft, setDraft] = useState<Policy>(persisted);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncedPersisted, setSyncedPersisted] = useState(persisted);

  // Dirty-guard: a background config refresh must not clobber in-progress
  // edits. Adjusted during render (not an effect — this is the React-
  // recommended way to reset derived state when a prop changes, and avoids
  // an extra commit-then-effect render pass): only resync the draft from
  // the persisted policy while nothing is unsaved.
  if (persisted !== syncedPersisted) {
    setSyncedPersisted(persisted);
    if (!dirty) setDraft(persisted);
  }

  const setField = (key: keyof Policy, value: Policy[keyof Policy]) => {
    setDraft(d => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const dirtyCount = useMemo(
    () => (Object.keys(draft) as (keyof Policy)[]).filter(k => draft[k] !== persisted[k]).length,
    [draft, persisted],
  );

  const handleSave = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      await update({ superAdminPolicies: draft }, currentUser._id, currentUser.username);
      setDirty(false);
      showToast(t('msg.securityAndCompliancePolicySaved'), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.securityAndCompliancePolicyNot')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(persisted);
    setDirty(false);
  };

  /* ── Number editor modal ────────────────────────────────────────────── */

  const [editing, setEditing] = useState<SettingField | null>(null);
  const [editValue, setEditValue] = useState('');

  const openEditor = (f: SettingField) => {
    setEditing(f);
    setEditValue(String(draft[f.key]));
  };

  const applyEditor = () => {
    if (!editing) return;
    const n = Number(editValue);
    if (!Number.isInteger(n) || n <= 0) {
      showToast(t('msg.enterAWholeNumberGreater'), 'error');
      return;
    }
    setField(editing.key, n);
    setEditing(null);
  };

  /* ── Posture (reads the persisted policy, not the draft) ────────────── */

  const postureRows = useMemo(() => [
    // A stated policy, not a measurement: nothing reads this number. Audit
    // entries are in fact never pruned on the server, so the trail is kept
    // regardless — the chip says which of the two this row is reporting.
    { label: t('adminMgmt.secPostureRetention'), tone: (persisted.auditRetentionYears >= 6 ? 'ok' : 'warn') as Tone, chip: t('adminMgmt.secRecordedPolicyChip', { count: persisted.auditRetentionYears }) },
    { label: t('adminMgmt.secPhiExport'), tone: (persisted.phiExportRequiresReason ? 'ok' : 'warn') as Tone, chip: persisted.phiExportRequiresReason ? t('basket.on') : t('basket.off') },
    { label: t('adminMgmt.secPostureDeletion'), tone: (persisted.dataDeletionRequiresApproval ? 'ok' : 'warn') as Tone, chip: persisted.dataDeletionRequiresApproval ? t('basket.on') : t('basket.off') },
    // Three states, not two: "unknown" claimed "At risk" before, which is a
    // finding this screen had not established.
    { label: t('adminMgmt.secPostureBackup'), tone: (backupUnknown ? 'muted' : backupWithinRpo ? 'ok' : 'warn') as Tone, chip: backupUnknown ? t('admin.healthUnknown') : backupWithinRpo ? t('adminMgmt.secWithinTarget') : t('billing.agingAtRisk') },
    { label: t('adminMgmt.secPostureEmergency'), tone: (persisted.emergencyAccessReviewHours > 0 ? 'ok' : 'warn') as Tone, chip: persisted.emergencyAccessReviewHours > 0 ? `${persisted.emergencyAccessReviewHours}h` : t('system.backupNotSet') },
  ], [persisted, backupUnknown, backupWithinRpo, t]);

  /* ── Rail (counts derived from the rows each section actually renders) */

  const railGroups = [{
    title: t('routeContext.security'),
    items: [
      { id: 'access', label: t('adminMgmt.secAccessTitle'), icon: Lock, count: ACCESS_FIELDS.length },
      { id: 'phi', label: t('adminMgmt.secPhiTitle'), icon: FileText, count: PHI_FIELDS.length },
      { id: 'breakglass', label: t('adminMgmt.secEmergencyAccess'), icon: AlertTriangle, count: BREAKGLASS_FIELDS.length },
      // +1: the backup-age fact row rendered alongside the two RPO/RTO fields.
      { id: 'continuity', label: t('adminMgmt.secBackupTitle'), icon: Clock, count: CONTINUITY_FIELDS.length + 1 },
      { id: 'watchlist', label: t('ui.securityWatchlist'), icon: Eye, count: watchlist.length },
      { id: 'overview', label: t('adminMgmt.secOverviewTitle'), icon: ShieldCheck, count: postureRows.length },
    ],
  }];

  return (
    <SadbPage>
      <SadbShell groups={railGroups} active={activeSection} onSelect={setActiveSection}>
        <SadbSaveBar dirtyCount={dirtyCount} saving={saving} onSave={handleSave} onDiscard={handleDiscard} />

        {activeSection === 'access' && (
          <>
            <SadbPanelHeader
              title={t('adminMgmt.secAccessTitle')}
              note={t('adminMgmt.secAccessNote')}
            />
            <SadbSettingGroup title={t('adminMgmt.secPasswordsSessions')}>
              {ACCESS_FIELDS.map(f => renderField(f, draft, setField, openEditor, t))}
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'phi' && (
          <>
            <SadbPanelHeader
              title={t('adminMgmt.secPhiTitle')}
              note={t('adminMgmt.secPhiNote')}
            />
            <SadbSettingGroup title={t('adminMgmt.secPhiGroup')}>
              {PHI_FIELDS.map(f => renderField(f, draft, setField, openEditor, t))}
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'breakglass' && (
          <>
            <SadbPanelHeader
              title={t('adminMgmt.secBreakTitle')}
              note={t('adminMgmt.secBreakNote')}
            />
            <SadbSettingGroup title={t('adminMgmt.secBreakGroup')}>
              {BREAKGLASS_FIELDS.map(f => renderField(f, draft, setField, openEditor, t))}
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'continuity' && (
          <>
            <SadbPanelHeader
              title={t('adminMgmt.secBackupTitle')}
              note={t('adminMgmt.secBackupNote')}
            />
            <SadbSettingGroup title={t('adminMgmt.secRecoveryTargets')}>
              {CONTINUITY_FIELDS.map(f => renderField(f, draft, setField, openEditor, t))}
              <SadbKvRow
                label={t('ui.currentBackupAge')}
                chip={backupUnknown ? t('adminMgmt.secBackupUnknown') : t('adminMgmt.secHoursAgo', { count: Math.round(backupAgeHours ?? 0) })}
                chipTone={TONE_CHIP[backupUnknown ? 'muted' : backupWithinRpo ? 'ok' : 'warn']}
              />
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'watchlist' && (
          <>
            <SadbPanelHeader
              title={t('ui.securityWatchlist')}
              note={t('adminMgmt.secWatchlistNote')}
              tag={t('adminMgmt.secLast7Days')}
            />
            <SadbCard
              title={t('ui.highRiskActions')}
              meta={auditLoading ? t('admin.loading') : t('adminMgmt.secNRecorded', { count: watchlist.length })}
            >
              {watchlist.length === 0 ? (
                <p className="sadb-empty">
                  {auditLoading ? t('adminMgmt.secReadingAudit') : t('adminMgmt.secNoHighRisk')}
                </p>
              ) : watchlist.map(({ log, severity }) => (
                <SadbQueueRow
                  key={log._id}
                  chip={t(SEVERITY_KEY[severity])}
                  chipTone={SEVERITY_CHIP[severity]}
                  title={log.action}
                  sub={`${log.username || t('admin.systemUser')} · ${log.details}`}
                  when={formatWhen(log.createdAt)}
                  onClick={() => router.push(`/admin/audit?log=${encodeURIComponent(log._id)}`)}
                />
              ))}
            </SadbCard>
          </>
        )}

        {activeSection === 'overview' && (
          <>
            <SadbPanelHeader
              title={t('adminMgmt.secOverviewTitle')}
              note={t('adminMgmt.secOverviewNote')}
            />
            <SadbCard title={t('adminMgmt.secChecks')}>
              {postureRows.map(r => (
                <SadbKvRow key={r.label} label={r.label} chip={r.chip} chipTone={TONE_CHIP[r.tone]} />
              ))}
            </SadbCard>

          </>
        )}
      </SadbShell>

      {editing && (
        <SadbEditorModal
          title={t(editing.label)}
          sub={t(editing.sub)}
          value={editValue}
          onChange={setEditValue}
          onCancel={() => setEditing(null)}
          onApply={applyEditor}
        />
      )}
    </SadbPage>
  );
}
