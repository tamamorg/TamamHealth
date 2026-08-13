'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { SaPage, SaCard, SaStatusDot } from '@/components/admin/sa-ui';
import { Building2, Server, ShieldAlert, Shield, MessageSquare } from '@/components/icons/lucide';
import { Save, ToggleLeft, ToggleRight } from '@/components/icons/lucide';

const inputStyle: React.CSSProperties = {
  height: 34, padding: '0 10px', border: '1px solid var(--ehr-border)', borderRadius: 8,
  fontSize: 12.5, color: 'var(--text-primary)', width: '100%',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
  color: 'var(--text-muted)', marginBottom: 6, display: 'block',
};

export default function AdminConfigPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { config, loading, update } = usePlatformConfig();

  const [platformName, setPlatformName] = useState('');
  const [defaultPrimaryColor, setDefaultPrimaryColor] = useState('var(--accent-primary)');
  const [defaultSecondaryColor, setDefaultSecondaryColor] = useState('var(--accent-hover)');
  const [savingIdentity, setSavingIdentity] = useState(false);

  const [trialDays, setTrialDays] = useState(30);
  const [maxOrganizations, setMaxOrganizations] = useState(100);
  const [signupsEnabled, setSignupsEnabled] = useState(true);
  const [savingTenantDefaults, setSavingTenantDefaults] = useState(false);

  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  useEffect(() => {
    if (!config) return;
    setPlatformName(config.platformName);
    setDefaultPrimaryColor(config.defaultPrimaryColor);
    setDefaultSecondaryColor(config.defaultSecondaryColor);
    setTrialDays(config.globalFeatureFlags.trialDays);
    setMaxOrganizations(config.globalFeatureFlags.maxOrganizations);
    setSignupsEnabled(config.globalFeatureFlags.signupsEnabled);
    setMaintenanceMode(config.maintenanceMode);
  }, [config]);

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
  const policies = config?.superAdminPolicies;

  const saveIdentity = async () => {
    setSavingIdentity(true);
    try {
      await update({ platformName, defaultPrimaryColor, defaultSecondaryColor }, currentUser?._id, currentUser?.username);
      showToast('Platform identity saved.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save.', 'error');
    } finally {
      setSavingIdentity(false);
    }
  };

  const saveTenantDefaults = async () => {
    setSavingTenantDefaults(true);
    try {
      await update({
        globalFeatureFlags: { trialDays, maxOrganizations, signupsEnabled },
      }, currentUser?._id, currentUser?.username);
      showToast('Tenant defaults saved.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save.', 'error');
    } finally {
      setSavingTenantDefaults(false);
    }
  };

  const saveMaintenance = async (next?: boolean) => {
    const value = next ?? maintenanceMode;
    setSavingMaintenance(true);
    try {
      await update({ maintenanceMode: value }, currentUser?._id, currentUser?.username);
      showToast(value ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save.', 'error');
    } finally {
      setSavingMaintenance(false);
    }
  };

  // Five distinct topics rather than one list — rendered one at a time from an
  // in-page rail (same shell as the System Administration console). Switching
  // is local state only: the URL never changes.
  const CONFIG_SECTIONS = [
    { id: 'identity', label: 'Platform identity', icon: Building2 },
    { id: 'defaults', label: 'Tenant defaults', icon: Server },
    { id: 'maintenance', label: 'Maintenance', icon: ShieldAlert },
    { id: 'security', label: 'Security policy defaults', icon: Shield },
    { id: 'templates', label: 'Notification templates', icon: MessageSquare },
  ] as const;
  const [section, setSection] = useState<typeof CONFIG_SECTIONS[number]['id']>('identity');

  return (
    <SaPage>
      <div className="ehr-set-grid">
        <aside className="ehr-set-rail">
          <nav className="ehr-set-nav" aria-label="Configuration sections">
            <div className="ehr-set-nav-group">
              <span className="ehr-set-nav-group-title">Configuration</span>
              {CONFIG_SECTIONS.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={section === item.id ? 'active' : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <Icon />
                    <em>{item.label}</em>
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>
        <main className="ehr-set-main">

        {section === 'identity' && (
        <SaCard title="Platform identity">
          {loading ? (
            <p className="sa-empty">Loading…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBlock: 12 }}>
              <div>
                <label style={labelStyle}>Platform name</label>
                <input type="text" value={platformName} onChange={e => setPlatformName(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Default primary color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={defaultPrimaryColor} onChange={e => setDefaultPrimaryColor(e.target.value)}
                      style={{ width: 34, height: 34, border: '1px solid var(--ehr-border)', borderRadius: 8, cursor: 'pointer', padding: 0 }} />
                    <input type="text" value={defaultPrimaryColor} onChange={e => setDefaultPrimaryColor(e.target.value)}
                      style={{ ...inputStyle, fontFamily: 'var(--font-platform-mono)' }} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Default secondary color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={defaultSecondaryColor} onChange={e => setDefaultSecondaryColor(e.target.value)}
                      style={{ width: 34, height: 34, border: '1px solid var(--ehr-border)', borderRadius: 8, cursor: 'pointer', padding: 0 }} />
                    <input type="text" value={defaultSecondaryColor} onChange={e => setDefaultSecondaryColor(e.target.value)}
                      style={{ ...inputStyle, fontFamily: 'var(--font-platform-mono)' }} />
                  </div>
                </div>
              </div>
              <button type="button" className="sa-btn primary" onClick={saveIdentity} disabled={savingIdentity} style={{ alignSelf: 'flex-start' }}>
                <Save className="w-3.5 h-3.5" /> {savingIdentity ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </SaCard>
        )}

        {section === 'defaults' && (
        <SaCard title="Tenant defaults">
          {loading ? (
            <p className="sa-empty">Loading…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBlock: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Trial days</label>
                  <input type="number" min={1} max={365} value={trialDays}
                    onChange={e => setTrialDays(parseInt(e.target.value) || 1)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Max organizations</label>
                  <input type="number" min={1} value={maxOrganizations}
                    onChange={e => setMaxOrganizations(parseInt(e.target.value) || 1)} style={inputStyle} />
                </div>
              </div>
              <div className="sa-policy-row" style={{ padding: 0, border: 0 }}>
                <span className="sa-policy-text">
                  <strong>New signups enabled</strong>
                  <span>Allow new organizations to self-register a trial.</span>
                </span>
                <button type="button" onClick={() => setSignupsEnabled(v => !v)} aria-pressed={signupsEnabled}>
                  {signupsEnabled ? (
                    <ToggleRight className="w-8 h-8" style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <ToggleLeft className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
                  )}
                </button>
              </div>
              <button type="button" className="sa-btn primary" onClick={saveTenantDefaults} disabled={savingTenantDefaults} style={{ alignSelf: 'flex-start' }}>
                <Save className="w-3.5 h-3.5" /> {savingTenantDefaults ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </SaCard>
        )}

        {section === 'maintenance' && (
        <SaCard title="Maintenance">
          {loading ? (
            <p className="sa-empty">Loading…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBlock: 12 }}>
              <div className="sa-policy-row" style={{ padding: 0, border: 0 }}>
                <span className="sa-policy-text">
                  <strong>Maintenance mode</strong>
                  <span>When on, only super admins can sign in — all other roles see a maintenance notice.</span>
                </span>
                <button
                  type="button"
                  onClick={() => { const next = !maintenanceMode; setMaintenanceMode(next); saveMaintenance(next); }}
                  disabled={savingMaintenance}
                  aria-pressed={maintenanceMode}
                >
                  {maintenanceMode ? (
                    <ToggleRight className="w-8 h-8" style={{ color: 'var(--color-danger)' }} />
                  ) : (
                    <ToggleLeft className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
                  )}
                </button>
              </div>
              <SaStatusDot tone={maintenanceMode ? 'danger' : 'ok'} label={maintenanceMode ? 'Platform in maintenance' : 'Platform operational'} />
              <div className="sa-kv-row" style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                <span>Build version</span>
                <span>{appVersion}</span>
              </div>
            </div>
          )}
        </SaCard>
        )}

        {section === 'security' && (
        <SaCard title="Security policy defaults" meta="Read-only" actions={
          <Link href="/admin/security" className="sa-btn">Edit in Security &amp; Compliance</Link>
        }>
          {!policies ? (
            <p className="sa-empty">Loading…</p>
          ) : (
            <div className="sa-kv">
              <div className="sa-kv-row"><span>MFA required</span><span>{policies.mfaRequired ? 'Yes' : 'No'}</span></div>
              <div className="sa-kv-row"><span>Password minimum length</span><span>{policies.passwordMinLength}</span></div>
              <div className="sa-kv-row"><span>Session timeout</span><span>{policies.sessionTimeoutMinutes}m</span></div>
              <div className="sa-kv-row"><span>Dual approval for high-risk actions</span><span>{policies.dualApprovalForHighRisk ? 'Yes' : 'No'}</span></div>
              <div className="sa-kv-row"><span>Audit retention</span><span>{policies.auditRetentionYears}y</span></div>
              <div className="sa-kv-row"><span>SSO enabled</span><span>{policies.ssoEnabled ? 'Yes' : 'No'}</span></div>
            </div>
          )}
        </SaCard>
        )}

        {section === 'templates' && (
        <SaCard title="Notification templates">
          <p className="sa-empty">No template store configured — email/SMS notifications use built-in copy.</p>
        </SaCard>
        )}

        </main>
      </div>
    </SaPage>
  );
}
