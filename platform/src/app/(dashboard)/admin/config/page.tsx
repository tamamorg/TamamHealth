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
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import NumberInput from '@/components/forms/NumberInput';

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
        style={{ width: 32, height: 32, border: '1px solid var(--border-light)', borderRadius: 0, cursor: 'pointer', padding: 0, flexShrink: 0 }}
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
  const { t } = useTranslation();
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

  const yesNo = (v: boolean) => t(v ? 'action.yes' : 'action.no');
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
      showToast(t('msg.platformConfigurationSaved'), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.platformConfigurationNotSavedTry')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!config) return;
    setDraft(draftFromConfig(config));
  };

  const railGroups = [{
    title: t('routeContext.configuration'),
    items: [
      { id: 'identity', label: t('ui.platformIdentity'), icon: Building2, count: identityDirty || undefined },
      { id: 'defaults', label: t('ui.tenantDefaults'), icon: Server, count: defaultsDirty || undefined },
      { id: 'maintenance', label: t('system.maintenance'), icon: ShieldAlert, count: maintenanceDirty || undefined },
      { id: 'security', label: t('ui.securityPolicyDefaults'), icon: Shield },
      { id: 'templates', label: t('ui.notificationTemplates'), icon: MessageSquare },
    ],
  }];

  return (
    <SadbPage>
      <SadbShell groups={railGroups} active={activeTab} onSelect={setActiveTab}>
        <SadbSaveBar dirtyCount={dirtyCount} saving={saving} onSave={handleSave} onDiscard={handleDiscard} />

        {!config || !draft ? (
          <SadbCard><p className="sadb-empty">{t('system.loadingConfiguration')}</p></SadbCard>
        ) : (
          <>
            {activeTab === 'identity' && (
              <>
                <SadbPanelHeader
                  title={t('ui.platformIdentity')}
                  note={t('adminMgmt.cfgIdentityNote')}
                />
                <SadbSettingGroup title={t('branding.title')}>
                  <SadbSettingRow label={t('ui.platformName')} sub={t('adminMgmt.cfgPlatformNameSub')}>
                    <input
                      className="sadb-modal-input"
                      style={{ maxWidth: 260 }}
                      value={draft.platformName}
                      onChange={e => setField('platformName', e.target.value)}
                    />
                  </SadbSettingRow>
                  <SadbSettingRow label={t('ui.defaultPrimaryColor')} sub={t('adminMgmt.cfgColorSub')}>
                    <ColorField value={draft.defaultPrimaryColor} onChange={v => setField('defaultPrimaryColor', v)} />
                  </SadbSettingRow>
                  <SadbSettingRow label={t('ui.defaultSecondaryColor')} sub={t('adminMgmt.cfgColorSub')}>
                    <ColorField value={draft.defaultSecondaryColor} onChange={v => setField('defaultSecondaryColor', v)} />
                  </SadbSettingRow>
                </SadbSettingGroup>
              </>
            )}

            {activeTab === 'defaults' && (
              <>
                <SadbPanelHeader
                  title={t('ui.tenantDefaults')}
                  note={t('adminMgmt.cfgDefaultsNote')}
                />
                <SadbSettingGroup title={t('adminMgmt.trialsAndCapacity')}>
                  <SadbSettingRow label={t('ui.trialDays')} sub={t('adminMgmt.cfgTrialDaysSub')}>
                    <NumberInput step="1" min={1} max={365}
                      className="sadb-modal-input" style={{ maxWidth: 120 }}
                      value={draft.trialDays}
                      onChange={e => setField('trialDays', parseInt(e.target.value, 10) || 1)}
                    />
                  </SadbSettingRow>
                  <SadbSettingRow label={t('ui.maxOrganizations')} sub={t('adminMgmt.cfgMaxOrgsSub')}>
                    <NumberInput step="1" min={1}
                      className="sadb-modal-input" style={{ maxWidth: 120 }}
                      value={draft.maxOrganizations}
                      onChange={e => setField('maxOrganizations', parseInt(e.target.value, 10) || 1)}
                    />
                  </SadbSettingRow>
                  <SadbSettingRow label={t('ui.newSignupsEnabled')} sub={t('adminMgmt.cfgSignupsSub')}>
                    <SadbToggle
                      checked={draft.signupsEnabled}
                      onChange={v => setField('signupsEnabled', v)}
                      label={t('ui.newSignupsEnabled')}
                    />
                  </SadbSettingRow>
                </SadbSettingGroup>
              </>
            )}

            {activeTab === 'maintenance' && (
              <>
                <SadbPanelHeader
                  title={t('system.maintenance')}
                  note={t('adminMgmt.cfgMaintNote')}
                  tag={config.maintenanceMode ? t('adminMgmt.liveNow') : t('admin.healthOperational')}
                  tagTone={config.maintenanceMode ? 'red' : 'green'}
                />
                <SadbSettingGroup title={t('ui.signInGate')}>
                  <SadbSettingRow label={t('ui.maintenanceMode')} sub={t('adminMgmt.cfgMaintSub')}>
                    <SadbToggle
                      checked={draft.maintenanceMode}
                      onChange={v => setField('maintenanceMode', v)}
                      label={t('ui.maintenanceMode')}
                    />
                  </SadbSettingRow>
                  {draft.maintenanceMode && (
                    <div className="sadb-signal sadb-signal--yellow" style={{ margin: '0 16px 14px' }}>
                      <b>{config.maintenanceMode ? t('adminMgmt.cfgMaintLive') : t('adminMgmt.cfgMaintWill')}</b>
                      <span>
                        {config.maintenanceMode
                          ? t('adminMgmt.cfgMaintLiveBody')
                          : t('adminMgmt.cfgMaintWillBody')}
                      </span>
                    </div>
                  )}
                  <SadbKvRow label={t('ui.buildVersion')} value={appVersion} />
                </SadbSettingGroup>
              </>
            )}

            {activeTab === 'security' && (
              <>
                <SadbPanelHeader
                  title={t('ui.securityPolicyDefaults')}
                  note={t('adminMgmt.cfgSecNote')}
                  tag={t('rxFlow.readOnly')}
                />
                <SadbCard action={<SadbHeadLink onClick={() => router.push('/admin/security')}>{t('adminConsole.editInSecuritySettings')}</SadbHeadLink>}>
                  {!policies ? (
                    <p className="sadb-empty">{t('admin.loading')}</p>
                  ) : (
                    <>
                      {/* The three the platform actually applies are stated
                          plainly; the rest are commitments the organisation
                          answers for and the platform does not police. Saying
                          which is which matters more here than anywhere,
                          because this is the screen that reads as a summary of
                          the deployment's posture. */}
                      <SadbKvRow label={t('ui.passwordMinimumLength')} value={policies.passwordMinLength} />
                      <SadbKvRow label={t('ui.sessionTimeout')} value={`${policies.sessionTimeoutMinutes}m`} />
                      <SadbKvRow
                        label={t('ui.dualApprovalForHighRisk')}
                        value={t('adminMgmt.notEnforced', { value: yesNo(policies.dualApprovalForHighRisk) })}
                      />
                      <SadbKvRow label={t('ui.auditRetention')} value={t('adminMgmt.notEnforced', { value: `${policies.auditRetentionYears}y` })} />
                      <SadbKvRow label={t('adminMgmt.singleSignOn')} value={t('adminMgmt.notEnforced', { value: yesNo(policies.ssoEnabled) })} />
                    </>
                  )}
                </SadbCard>
              </>
            )}

            {activeTab === 'templates' && (
              <>
                <SadbPanelHeader title={t('ui.notificationTemplates')} note={t('adminMgmt.cfgTemplatesNote')} />
                <SadbCard>
                  <p className="sadb-empty">{t('adminMgmt.cfgNoTemplates')}</p>
                </SadbCard>
              </>
            )}
          </>
        )}
      </SadbShell>
    </SadbPage>
  );
}
