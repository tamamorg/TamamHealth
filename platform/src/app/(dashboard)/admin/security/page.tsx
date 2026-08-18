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
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { useBackupStatus } from '@/lib/hooks/useBackupStatus';
import type { PlatformConfigDoc } from '@/lib/db-types';
import { DEFAULT_POLICIES } from '@/lib/admin/super-admin-policies';
import { Lock, FileText, AlertTriangle, Clock, ShieldCheck } from '@/components/icons/lucide';
import {
  SadbPage, SadbShell, useSadbTab, SadbPanelHeader, SadbSettingGroup, SadbSettingRow,
  SadbToggle, SadbValueButton, SadbEditorModal, SadbCard, SadbKvRow, SadbHeadLink,
  SadbSaveBar, TONE_CHIP, type Tone,
} from '@/components/admin/sadb-ui';

type Policy = NonNullable<PlatformConfigDoc['superAdminPolicies']>;

interface SettingField {
  kind: 'toggle' | 'number';
  key: keyof Policy;
  label: string;
  sub: string;
  /** Appended straight after the value, e.g. "15m", "6y", " characters". */
  unit?: string;
}

const ACCESS_FIELDS: SettingField[] = [
  { kind: 'toggle', key: 'mfaRequired', label: 'Require MFA', sub: 'Multi-factor authentication for privileged access.' },
  { kind: 'number', key: 'passwordMinLength', label: 'Password minimum', sub: 'Minimum password length, characters.', unit: ' characters' },
  { kind: 'number', key: 'sessionTimeoutMinutes', label: 'Session timeout', sub: 'Idle session timeout, minutes.', unit: 'm' },
  { kind: 'toggle', key: 'ssoEnabled', label: 'SSO controls', sub: 'Expose SAML/OIDC controls per organization.' },
];

const PHI_FIELDS: SettingField[] = [
  { kind: 'toggle', key: 'phiExportRequiresReason', label: 'Reason required for PHI export', sub: 'Exports must include purpose and requester.' },
  { kind: 'toggle', key: 'dataDeletionRequiresApproval', label: 'Approval before deletion', sub: 'Hard deletion and tenant data removal need approval.' },
  { kind: 'number', key: 'auditRetentionYears', label: 'Audit retention', sub: 'Audit documentation retention window, years.', unit: 'y' },
  { kind: 'toggle', key: 'apiKeysEnabled', label: 'API keys', sub: 'Enable tenant API key issuance and rotation.' },
];

const BREAKGLASS_FIELDS: SettingField[] = [
  { kind: 'toggle', key: 'emergencyAccessEnabled', label: 'Emergency access', sub: 'Allow break-glass access with follow-up review.' },
  { kind: 'number', key: 'emergencyAccessReviewHours', label: 'Emergency review window', sub: 'Hours to review break-glass access after use.', unit: 'h' },
  { kind: 'toggle', key: 'impersonationEnabled', label: 'Support impersonation', sub: 'Allow isolated tenant support sessions with audit trail.' },
  { kind: 'number', key: 'impersonationMaxMinutes', label: 'Impersonation max duration', sub: 'Maximum impersonation session length, minutes.', unit: 'm' },
  { kind: 'toggle', key: 'supportAccessRequiresTicket', label: 'Require support ticket', sub: 'Support access must carry a ticket or incident reference.' },
  { kind: 'toggle', key: 'dualApprovalForHighRisk', label: 'Dual approval', sub: 'Require a second approver for destructive or privileged actions.' },
];

const CONTINUITY_FIELDS: SettingField[] = [
  { kind: 'number', key: 'backupRpoHours', label: 'Recovery point objective', sub: 'Maximum acceptable data loss window, hours.', unit: 'h' },
  { kind: 'number', key: 'backupRtoHours', label: 'Recovery time objective', sub: 'Maximum acceptable restore time, hours.', unit: 'h' },
];

function formatValue(f: SettingField, value: number): string {
  return `${value}${f.unit ?? ''}`;
}

function renderField(f: SettingField, draft: Policy, onToggle: (key: keyof Policy, value: boolean) => void, onEditNumber: (f: SettingField) => void) {
  if (f.kind === 'toggle') {
    return (
      <SadbSettingRow key={f.key} label={f.label} sub={f.sub}>
        <SadbToggle checked={Boolean(draft[f.key])} onChange={v => onToggle(f.key, v)} label={f.label} />
      </SadbSettingRow>
    );
  }
  return (
    <SadbSettingRow key={f.key} label={f.label} sub={f.sub}>
      <SadbValueButton value={formatValue(f, draft[f.key] as number)} onClick={() => onEditNumber(f)} title={`Edit ${f.label.toLowerCase()}`} />
    </SadbSettingRow>
  );
}

export default function SecurityCompliancePage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { config, update } = usePlatformConfig();
  const [backupAgeHours, setBackupAgeHours] = useState<number | null>(null);

  const [activeSection, setActiveSection] = useSadbTab('access');

  // Single source (KAN-117) — this used to read a localStorage key nothing
  // wrote, so "backupWithinRpo" was permanently false and reported as if
  // measured.
  const backupStatus = useBackupStatus();
  useEffect(() => {
    if (backupStatus?.ageHours != null) setBackupAgeHours(backupStatus.ageHours);
  }, [backupStatus]);

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
      showToast('Security & compliance policy saved.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save policy.', 'error');
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
      showToast('Enter a whole number greater than 0.', 'error');
      return;
    }
    setField(editing.key, n);
    setEditing(null);
  };

  /* ── Posture (reads the persisted policy, not the draft) ────────────── */

  const postureRows = useMemo(() => [
    { label: 'MFA required', tone: (persisted.mfaRequired ? 'ok' : 'warn') as Tone, chip: persisted.mfaRequired ? 'On' : 'Off' },
    { label: 'Audit retention ≥ 6 years', tone: (persisted.auditRetentionYears >= 6 ? 'ok' : 'warn') as Tone, chip: `${persisted.auditRetentionYears}y` },
    { label: 'PHI export control', tone: (persisted.phiExportRequiresReason ? 'ok' : 'warn') as Tone, chip: persisted.phiExportRequiresReason ? 'On' : 'Off' },
    { label: 'Deletion approval', tone: (persisted.dataDeletionRequiresApproval ? 'ok' : 'warn') as Tone, chip: persisted.dataDeletionRequiresApproval ? 'On' : 'Off' },
    // Three states, not two: "unknown" claimed "At risk" before, which is a
    // finding this screen had not established.
    { label: 'Backup within RPO', tone: (backupUnknown ? 'muted' : backupWithinRpo ? 'ok' : 'warn') as Tone, chip: backupUnknown ? 'Unknown' : backupWithinRpo ? 'Within RPO' : 'At risk' },
    { label: 'Break-glass review window set', tone: (persisted.emergencyAccessReviewHours > 0 ? 'ok' : 'warn') as Tone, chip: persisted.emergencyAccessReviewHours > 0 ? `${persisted.emergencyAccessReviewHours}h` : 'Not set' },
  ], [persisted, backupUnknown, backupWithinRpo]);

  /* ── Rail (counts derived from the rows each section actually renders) */

  const railGroups = [{
    title: 'Security & Compliance',
    items: [
      { id: 'access', label: 'Access & Auth', icon: Lock, count: ACCESS_FIELDS.length },
      { id: 'phi', label: 'PHI & Data Controls', icon: FileText, count: PHI_FIELDS.length },
      { id: 'breakglass', label: 'Break-glass', icon: AlertTriangle, count: BREAKGLASS_FIELDS.length },
      // +1: the backup-age fact row rendered alongside the two RPO/RTO fields.
      { id: 'continuity', label: 'Continuity Objectives', icon: Clock, count: CONTINUITY_FIELDS.length + 1 },
      { id: 'overview', label: 'Posture & Evidence', icon: ShieldCheck, count: postureRows.length },
    ],
  }];

  return (
    <SadbPage>
      <SadbShell groups={railGroups} active={activeSection} onSelect={setActiveSection}>
        <SadbSaveBar dirtyCount={dirtyCount} saving={saving} onSave={handleSave} onDiscard={handleDiscard} />

        {activeSection === 'access' && (
          <>
            <SadbPanelHeader
              title="Access & authentication"
              note="Authentication requirements applied platform-wide. Changes apply once saved above."
            />
            <SadbSettingGroup title="Access & authentication">
              {ACCESS_FIELDS.map(f => renderField(f, draft, setField, openEditor))}
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'phi' && (
          <>
            <SadbPanelHeader
              title="PHI & data controls"
              note="Controls governing PHI export, deletion, and API key issuance across every tenant."
            />
            <SadbSettingGroup title="PHI & data controls">
              {PHI_FIELDS.map(f => renderField(f, draft, setField, openEditor))}
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'breakglass' && (
          <>
            <SadbPanelHeader
              title="Break-glass & support access"
              note="Emergency and support access paths, each with a required review window or audit trail."
            />
            <SadbSettingGroup title="Break-glass & support access">
              {BREAKGLASS_FIELDS.map(f => renderField(f, draft, setField, openEditor))}
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'continuity' && (
          <>
            <SadbPanelHeader
              title="Continuity objectives"
              note="Backup recovery targets, plus the last backup age actually reported by the system."
            />
            <SadbSettingGroup title="Continuity objectives">
              {CONTINUITY_FIELDS.map(f => renderField(f, draft, setField, openEditor))}
              <SadbKvRow
                label="Current backup age"
                chip={backupUnknown ? 'Unknown — nothing reported' : `${Math.round(backupAgeHours ?? 0)}h ago`}
                chipTone={TONE_CHIP[backupUnknown ? 'muted' : backupWithinRpo ? 'ok' : 'warn']}
              />
            </SadbSettingGroup>
          </>
        )}

        {activeSection === 'overview' && (
          <>
            <SadbPanelHeader
              title="Security posture"
              note="Live read of the persisted policy and the most recent backup report — nothing here is simulated."
            />
            <SadbCard title="Security posture">
              {postureRows.map(r => (
                <SadbKvRow key={r.label} label={r.label} chip={r.chip} chipTone={TONE_CHIP[r.tone]} />
              ))}
            </SadbCard>

            <SadbCard
              title="Compliance evidence"
              action={<SadbHeadLink onClick={() => router.push('/admin/audit')}>Open Audit Logs</SadbHeadLink>}
            >
              <p style={{ margin: '10px 14px 14px', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600 }}>
                Full audit trail export with user, org, action, and risk classification lives in Audit Logs.
              </p>
            </SadbCard>
          </>
        )}
      </SadbShell>

      {editing && (
        <SadbEditorModal
          title={editing.label}
          sub={editing.sub}
          value={editValue}
          onChange={setEditValue}
          onCancel={() => setEditing(null)}
          onApply={applyEditor}
        />
      )}
    </SadbPage>
  );
}
