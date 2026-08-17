'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import {
  SadbPage, SadbShell, useSadbTab, SadbPanelHeader, SadbSettingGroup, SadbSettingRow,
  SadbToggle, SadbSaveBar, SadbCard, SadbKvRow, SadbHeadLink,
} from '@/components/admin/sadb-ui';
import { Building2, Server, ShieldAlert, Shield, MessageSquare } from '@/components/icons/lucide';
import type { PlatformConfigDoc } from '@/lib/db-types';

/** One flat draft covering every editable field across the identity,
 *  tenant-defaults, and maintenance sections — so the whole page shares a
 *  single dirty-state and a single save bar instead of three. */
interface ConfigDraft {
  platformName: string;
  defaultPrimaryColor: string;
  defaultSecondaryColor: string;
  trialDays: number;
  maxOrganizations: number;
  signupsEnabled: boolean;
  maintenanceMode: boolean;
}

function draftFromConfig(config: PlatformConfigDoc): ConfigDraft {
  return {
    platformName: config.platformName,
    defaultPrimaryColor: config.defaultPrimaryColor,
    defaultSecondaryColor: config.defaultSecondaryColor,
    trialDays: config.globalFeatureFlags.trialDays,
    maxOrganizations: config.globalFeatureFlags.maxOrganizations,
    signupsEnabled: config.globalFeatureFlags.signupsEnabled,
    maintenanceMode: config.maintenanceMode,
  };
}

function diffCount(draft: ConfigDraft | null, base: ConfigDraft | null, keys: (keyof ConfigDraft)[]): number {
  if (!draft || !base) return 0;
  return keys.reduce((n, k) => n + (draft[k] !== base[k] ? 1 : 0), 0);
}

const IDENTITY_KEYS: (keyof ConfigDraft)[] = ['platformName', 'defaultPrimaryColor', 'defaultSecondaryColor'];
const DEFAULTS_KEYS: (keyof ConfigDraft)[] = ['trialDays', 'maxOrganizations', 'signupsEnabled'];
const MAINTENANCE_KEYS: (keyof ConfigDraft)[] = ['maintenanceMode'];

/** Native color swatch + hex field; the text half uses the kit's modal-input
 *  style (there is no dedicated sadb color-swatch control — see report). */
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2" style={{ maxWidth: 220 }}>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 32, border: '1px solid var(--border-light)', borderRadius: 6, cursor: 'pointer', padding: 0, flexShrink: 0 }}
      />
      <input
        className="sadb-modal-input"
        style={{ fontFamily: 'var(--font-platform-mono)' }}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

export default function AdminConfigPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { config, update } = usePlatformConfig();

  const [activeTab, setActiveTab] = useSadbTab('identity');
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const configDraft = config ? draftFromConfig(config) : null;
  const identityDirty = diffCount(draft, configDraft, IDENTITY_KEYS);
  const defaultsDirty = diffCount(draft, configDraft, DEFAULTS_KEYS);
  const maintenanceDirty = diffCount(draft, configDraft, MAINTENANCE_KEYS);
  const dirtyCount = identityDirty + defaultsDirty + maintenanceDirty;

  // Dirty-guard: only reseed the draft from config while nothing is pending,
  // so a background config refresh (another admin's edit, a poll) can never
  // clobber a form the user is mid-editing.
  useEffect(() => {
    if (!config || dirtyCount > 0) return;
    setDraft(draftFromConfig(config));
  }, [config, dirtyCount]);

  const setField = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => {
    setDraft(d => (d ? { ...d, [key]: value } : d));
  };

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
  const policies = config?.superAdminPolicies;

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await update({
        platformName: draft.platformName,
        defaultPrimaryColor: draft.defaultPrimaryColor,
        defaultSecondaryColor: draft.defaultSecondaryColor,
        globalFeatureFlags: {
          trialDays: draft.trialDays,
          maxOrganizations: draft.maxOrganizations,
          signupsEnabled: draft.signupsEnabled,
        },
        maintenanceMode: draft.maintenanceMode,
      }, currentUser?._id, currentUser?.username);
      showToast('Platform configuration saved.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save configuration.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!config) return;
    setDraft(draftFromConfig(config));
  };

  const railGroups = [{
    title: 'Configuration',
    items: [
      { id: 'identity', label: 'Platform identity', icon: Building2, count: identityDirty || undefined },
      { id: 'defaults', label: 'Tenant defaults', icon: Server, count: defaultsDirty || undefined },
      { id: 'maintenance', label: 'Maintenance', icon: ShieldAlert, count: maintenanceDirty || undefined },
      { id: 'security', label: 'Security policy defaults', icon: Shield },
      { id: 'templates', label: 'Notification templates', icon: MessageSquare },
    ],
  }];

  return (
    <SadbPage>
      <SadbShell groups={railGroups} active={activeTab} onSelect={setActiveTab}>
        <SadbSaveBar dirtyCount={dirtyCount} saving={saving} onSave={handleSave} onDiscard={handleDiscard} />

        {!config || !draft ? (
          <SadbCard><p className="sadb-empty">Loading configuration…</p></SadbCard>
        ) : (
          <>
            {activeTab === 'identity' && (
              <>
                <SadbPanelHeader
                  title="Platform identity"
                  note="Name and default brand colors shown across the platform shell and applied to new tenants."
                />
                <SadbSettingGroup title="Branding">
                  <SadbSettingRow label="Platform name" sub="Shown in the app header and browser tab.">
                    <input
                      className="sadb-modal-input"
                      style={{ maxWidth: 260 }}
                      value={draft.platformName}
                      onChange={e => setField('platformName', e.target.value)}
                    />
                  </SadbSettingRow>
                  <SadbSettingRow label="Default primary color" sub="Applied to new tenants unless they set their own.">
                    <ColorField value={draft.defaultPrimaryColor} onChange={v => setField('defaultPrimaryColor', v)} />
                  </SadbSettingRow>
                  <SadbSettingRow label="Default secondary color" sub="Applied to new tenants unless they set their own.">
                    <ColorField value={draft.defaultSecondaryColor} onChange={v => setField('defaultSecondaryColor', v)} />
                  </SadbSettingRow>
                </SadbSettingGroup>
              </>
            )}

            {activeTab === 'defaults' && (
              <>
                <SadbPanelHeader
                  title="Tenant defaults"
                  note="Trial length, capacity ceiling, and self-service signup applied to every new organization."
                />
                <SadbSettingGroup title="Trial & capacity">
                  <SadbSettingRow label="Trial days" sub="Length of the free trial period for new organizations.">
                    <input
                      type="number" min={1} max={365}
                      className="sadb-modal-input" style={{ maxWidth: 120 }}
                      value={draft.trialDays}
                      onChange={e => setField('trialDays', parseInt(e.target.value, 10) || 1)}
                    />
                  </SadbSettingRow>
                  <SadbSettingRow label="Max organizations" sub="Platform-wide ceiling on the number of tenant organizations.">
                    <input
                      type="number" min={1}
                      className="sadb-modal-input" style={{ maxWidth: 120 }}
                      value={draft.maxOrganizations}
                      onChange={e => setField('maxOrganizations', parseInt(e.target.value, 10) || 1)}
                    />
                  </SadbSettingRow>
                  <SadbSettingRow label="New signups enabled" sub="Allow new organizations to self-register a trial.">
                    <SadbToggle
                      checked={draft.signupsEnabled}
                      onChange={v => setField('signupsEnabled', v)}
                      label="New signups enabled"
                    />
                  </SadbSettingRow>
                </SadbSettingGroup>
              </>
            )}

            {activeTab === 'maintenance' && (
              <>
                <SadbPanelHeader
                  title="Maintenance"
                  note="Platform-wide sign-in gate. Only super admins can reach the app while this is on."
                  tag={config.maintenanceMode ? 'Live now' : 'Operational'}
                  tagTone={config.maintenanceMode ? 'red' : 'green'}
                />
                <SadbSettingGroup title="Sign-in gate">
                  <SadbSettingRow label="Maintenance mode" sub="When on, only super admins can sign in — all other roles see a maintenance notice.">
                    <SadbToggle
                      checked={draft.maintenanceMode}
                      onChange={v => setField('maintenanceMode', v)}
                      label="Maintenance mode"
                    />
                  </SadbSettingRow>
                  {draft.maintenanceMode && (
                    <div className="sadb-signal sadb-signal--yellow" style={{ margin: '0 16px 14px' }}>
                      <b>{config.maintenanceMode ? 'Maintenance mode is live' : 'This will restrict tenant access'}</b>
                      <span>
                        {config.maintenanceMode
                          ? 'Only super admins can sign in right now — all other roles see a maintenance notice.'
                          : 'Saving turns this on immediately: all non-super-admin roles will be signed out of new sessions.'}
                      </span>
                    </div>
                  )}
                  <SadbKvRow label="Build version" value={appVersion} />
                </SadbSettingGroup>
              </>
            )}

            {activeTab === 'security' && (
              <>
                <SadbPanelHeader
                  title="Security policy defaults"
                  note="Configured from Security & Compliance — this page shows the current values only."
                  tag="Read-only"
                />
                <SadbCard action={<SadbHeadLink onClick={() => router.push('/admin/security')}>Edit in Security &amp; Compliance</SadbHeadLink>}>
                  {!policies ? (
                    <p className="sadb-empty">Loading…</p>
                  ) : (
                    <>
                      <SadbKvRow label="MFA required" value={policies.mfaRequired ? 'Yes' : 'No'} />
                      <SadbKvRow label="Password minimum length" value={policies.passwordMinLength} />
                      <SadbKvRow label="Session timeout" value={`${policies.sessionTimeoutMinutes}m`} />
                      <SadbKvRow label="Dual approval for high-risk actions" value={policies.dualApprovalForHighRisk ? 'Yes' : 'No'} />
                      <SadbKvRow label="Audit retention" value={`${policies.auditRetentionYears}y`} />
                      <SadbKvRow label="SSO enabled" value={policies.ssoEnabled ? 'Yes' : 'No'} />
                    </>
                  )}
                </SadbCard>
              </>
            )}

            {activeTab === 'templates' && (
              <>
                <SadbPanelHeader title="Notification templates" note="Copy used for platform email and SMS notifications." />
                <SadbCard>
                  <p className="sadb-empty">No template store configured — email and SMS notifications use built-in copy.</p>
                </SadbCard>
              </>
            )}
          </>
        )}
      </SadbShell>
    </SadbPage>
  );
}
