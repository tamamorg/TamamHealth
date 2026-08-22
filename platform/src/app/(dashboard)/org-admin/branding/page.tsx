'use client';

/**
 * Organization branding, on the shared admin console kit (sadb-*).
 * Restyled from hand-rolled dash-cards 2026-08-21: setting groups + rows,
 * and a real dirty-state save bar (SadbSaveBar) instead of an always-live
 * Save button — Reset is the bar's Discard. Banners became toasts.
 *
 * Deliberately NOT a SadbShell rail page: with only two sections a rail
 * would bury the live preview in a tab, and side-by-side editing+preview is
 * the whole point of this screen. The preview keeps the tenant colours as
 * inline literals — previewing the tenant's palette is its job; the console
 * chrome around it stays token-blue.
 *
 * Overlap note: Settings → Organization (OrganizationSettingsPanel) also
 * edits org identity. This page is the branding-focused editor with the
 * live preview; don't add a third.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToast } from '@/components/Toast';
import {
  Palette, Upload, X, Building2, Users,
  LayoutDashboard, BarChart3, Settings, MessageSquare,
} from '@/components/icons/lucide';
import type { OrganizationDoc } from '@/lib/db-types';
import {
  SadbPage, SadbPanelHeader, SadbSettingGroup, SadbSettingRow, SadbSaveBar, SadbCard,
} from '@/components/admin/sadb-ui';

interface BrandingDraft {
  orgName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | undefined;
  bankDetails: string;
}

function draftFromOrg(o: OrganizationDoc): BrandingDraft {
  return {
    orgName: o.name,
    primaryColor: o.primaryColor || 'var(--accent-primary)',
    secondaryColor: o.secondaryColor || 'var(--accent-hover)',
    accentColor: o.accentColor || 'var(--accent-primary)',
    logoUrl: o.logoUrl,
    bankDetails: o.bankDetails || '',
  };
}

function dirtyCount(draft: BrandingDraft | null, base: BrandingDraft | null): number {
  if (!draft || !base) return 0;
  return (Object.keys(draft) as (keyof BrandingDraft)[])
    .reduce((n, k) => n + (draft[k] !== base[k] ? 1 : 0), 0);
}

/** Native colour swatch + hex field, same pairing as /admin/config's. */
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2" style={{ maxWidth: 240 }}>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 32, border: '1px solid var(--border-light)', borderRadius: 6, cursor: 'pointer', padding: 0, flexShrink: 0 }}
      />
      <input
        className="sadb-modal-input font-mono"
        style={{ minHeight: 32, padding: '4px 10px', fontSize: 12.5 }}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

export default function OrgBrandingPage() {
  const { currentUser, refreshCurrentUser } = useAuth();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [base, setBase] = useState<BrandingDraft | null>(null);
  const [draft, setDraft] = useState<BrandingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    // No organization to brand (the platform operator) — stop loading so the
    // page reports that instead of spinning forever.
    if (!currentUser.orgId) { setLoading(false); return; }
    const load = async () => {
      try {
        const { getOrganizationById } = await import('@/lib/services/organization-service');
        const o = await getOrganizationById(currentUser.orgId!);
        if (o) {
          const d = draftFromOrg(o);
          setBase(d);
          setDraft(d);
        }
      } catch (err) {
        console.error('Failed to load org:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.orgId]);

  const set = <K extends keyof BrandingDraft>(key: K, value: BrandingDraft[K]) =>
    setDraft(d => (d ? { ...d, [key]: value } : d));

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512000) {
      showToast(t('branding.errorLogoSize'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => set('logoUrl', reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!draft || !currentUser?.orgId) return;
    if (!draft.orgName.trim()) {
      showToast(t('branding.errorNameRequired'), 'error');
      return;
    }

    // A colour that `getOrgBranding` would reject is a colour that vanishes on
    // the next sign-in. Say so now, while the operator is still looking at the
    // field, rather than letting them discover it tomorrow.
    const { isUsableBrandColor } = await import('@/lib/branding');
    const badColor = ([
      [t('branding.primaryColor'), draft.primaryColor],
      [t('branding.secondaryColor'), draft.secondaryColor],
      [t('branding.accentColor'), draft.accentColor],
    ] as const).find(([, value]) => !isUsableBrandColor(value));
    if (badColor) {
      showToast(t('branding.errorInvalidColor', { field: badColor[0], value: badColor[1] }), 'error');
      return;
    }

    setSaving(true);
    try {
      const { updateOrganization } = await import('@/lib/services/organization-service');
      await updateOrganization(
        currentUser.orgId,
        {
          name: draft.orgName.trim(),
          primaryColor: draft.primaryColor,
          secondaryColor: draft.secondaryColor,
          accentColor: draft.accentColor,
          logoUrl: draft.logoUrl,
          bankDetails: draft.bankDetails.trim(),
        },
        currentUser._id,
        currentUser.username
      );

      // Apply branding CSS variables live — through the SAME resolver login
      // and session restore use. Applying the raw fields here is how a colour
      // could look applied until the next reload quietly dropped it: the hex
      // field beside each swatch accepts free text, and `getOrgBranding`
      // rejects anything that is not a hex colour.
      const { brandingToCSSVars, brandingFromFields } = await import('@/lib/branding');
      const vars = brandingToCSSVars(brandingFromFields({
        name: draft.orgName.trim(),
        logoUrl: draft.logoUrl,
        primaryColor: draft.primaryColor,
        secondaryColor: draft.secondaryColor,
        accentColor: draft.accentColor,
      }));
      for (const [key, value] of Object.entries(vars)) {
        document.documentElement.style.setProperty(key, value);
      }
      // CSS variables are only half of it — the org name in the header and
      // `currentUser.branding` (logo, brand colour) come from the session.
      await refreshCurrentUser();

      setBase(draft);
      showToast(t('branding.savedSuccess'), 'success');
    } catch (err: unknown) {
      const e = err as Error;
      showToast(e.message || t('branding.errorSave'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Sidebar preview nav items
  const previewNav = [
    { icon: LayoutDashboard, key: 'dashboard', label: t('nav.dashboard') },
    { icon: Users, key: 'users', label: t('breadcrumb.users') },
    { icon: Building2, key: 'facilities', label: t('government.colFacilities') },
    { icon: Palette, key: 'branding', label: t('branding.title'), active: true },
    { icon: BarChart3, key: 'analytics', label: t('branding.navAnalytics') },
    { icon: Settings, key: 'settings', label: t('nav.settings') },
    { icon: MessageSquare, key: 'messages', label: t('breadcrumb.messages') },
  ];

  const dirty = dirtyCount(draft, base);

  if (loading || !draft) {
    return (
      <SadbPage roles={['org_admin', 'super_admin']}>
        <SadbPanelHeader title={t('branding.title')} note={t('branding.subtitle')} />
        {/* Two states share this branch: still loading, and loaded-but-no-org
            (an account whose organization record is not in the local replica,
            or a platform operator with no orgId). Only the first is transient,
            so say which one this is instead of spinning forever. */}
        <p className="sadb-empty">
          {loading ? t('common.loading') : t('analytics.noDataShort')}
        </p>
      </SadbPage>
    );
  }

  const { orgName, primaryColor, secondaryColor, accentColor, logoUrl, bankDetails } = draft;

  return (
    <SadbPage
      roles={['org_admin', 'super_admin']}
      actions={
        <SadbSaveBar
          dirtyCount={dirty}
          saving={saving}
          onSave={handleSave}
          onDiscard={() => setDraft(base)}
        />
      }
    >
      <SadbPanelHeader title={t('branding.title')} note={t('branding.subtitle')} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        {/* ═══ Editor column ═══ */}
        <div className="flex flex-col gap-3.5 min-w-0">
          <SadbSettingGroup title={t('branding.heading')}>
            <SadbSettingRow label={t('branding.orgName')}>
              <input
                className="sadb-modal-input"
                style={{ maxWidth: 280, minHeight: 34, padding: '6px 11px', fontSize: 13 }}
                value={orgName}
                onChange={e => set('orgName', e.target.value)}
              />
            </SadbSettingRow>
            <SadbSettingRow label={t('branding.logo')} sub={t('branding.logoHint')}>
              <span className="flex items-center gap-3 flex-shrink-0">
                {logoUrl ? (
                  <span className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={t('branding.logo')}
                      className="w-12 h-12 rounded-lg object-cover"
                      style={{ border: '1px solid var(--border-light)' }}
                    />
                    <button
                      type="button"
                      onClick={() => set('logoUrl', undefined)}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--color-danger)', color: '#fff' }}
                      aria-label="Remove logo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ) : (
                  <span
                    className="w-12 h-12 rounded-lg inline-flex items-center justify-center"
                    style={{ background: 'var(--ehr-head)', border: '2px dashed var(--border-light)' }}
                  >
                    <Upload className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                  </span>
                )}
                <label className="sadb-action-btn cursor-pointer inline-flex items-center gap-1.5" style={{ textTransform: 'uppercase' }}>
                  <Upload className="w-3.5 h-3.5" />
                  {t('branding.uploadLogo')}
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
              </span>
            </SadbSettingRow>
          </SadbSettingGroup>

          <div data-tour="org-branding-colors">
            <SadbSettingGroup title={t('branding.brandColors')}>
              <SadbSettingRow label={t('branding.primaryColor')}>
                <ColorField value={primaryColor} onChange={v => set('primaryColor', v)} />
              </SadbSettingRow>
              <SadbSettingRow label={t('branding.secondaryColor')}>
                <ColorField value={secondaryColor} onChange={v => set('secondaryColor', v)} />
              </SadbSettingRow>
              <SadbSettingRow label={t('branding.accentColor')}>
                <ColorField value={accentColor} onChange={v => set('accentColor', v)} />
              </SadbSettingRow>
            </SadbSettingGroup>
          </div>

          <SadbSettingGroup title={t('branding.bankDetails')}>
            <div style={{ padding: '12px 16px' }}>
              <textarea
                className="sadb-modal-input font-mono"
                rows={4}
                value={bankDetails}
                onChange={e => set('bankDetails', e.target.value)}
                placeholder={t('branding.bankDetailsPlaceholder')}
              />
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {t('branding.bankDetailsHint')}
              </p>
            </div>
          </SadbSettingGroup>
        </div>

        {/* ═══ Live preview ═══ */}
        <SadbCard title={t('branding.livePreview')}>
          <div className="p-4">
            {/* Simulated sidebar + header */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
              <div className="flex" style={{ height: 360 }}>
                {/* Sidebar preview */}
                <div className="w-[200px] flex flex-col" style={{ background: '#001D3F' }}>
                  {/* Sidebar header */}
                  <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="w-7 h-7 rounded-md object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-bold" style={{ background: primaryColor }}>
                        {(orgName || 'O')[0]}
                      </div>
                    )}
                    <span className="text-sm font-bold text-white truncate">{orgName || t('branding.organization')}</span>
                  </div>

                  {/* Nav items */}
                  <div className="flex-1 px-2 py-2 space-y-0.5 overflow-hidden">
                    {previewNav.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.key}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                          style={{
                            background: item.active ? `${primaryColor}20` : 'transparent',
                            color: item.active ? primaryColor : 'rgba(255,255,255,0.5)',
                            borderInlineStart: item.active ? `2px solid ${primaryColor}` : '2px solid transparent',
                          }}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* User pill */}
                  <div className="px-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: primaryColor }}>
                        OA
                      </div>
                      <div className="text-[10px]">
                        <p className="text-white/80 font-medium truncate">{t('branding.orgAdmin')}</p>
                        <p className="text-white/40">{t('branding.adminRole')}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main area preview */}
                <div className="flex-1 flex flex-col">
                  {/* Top bar preview */}
                  <div className="h-[40px] flex items-center px-4" style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('branding.orgDashboard')}</span>
                    <div className="ms-auto flex items-center gap-2">
                      <div className="w-4 h-4 rounded" style={{ background: primaryColor, opacity: 0.3 }} />
                      <div className="w-4 h-4 rounded" style={{ background: secondaryColor, opacity: 0.3 }} />
                      <div className="w-4 h-4 rounded" style={{ background: accentColor, opacity: 0.3 }} />
                    </div>
                  </div>

                  {/* Content preview */}
                  <div className="flex-1 p-3 space-y-2">
                    {/* Mini stat cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                        <div className="w-5 h-5 rounded mb-1 flex items-center justify-center" style={{ background: `${primaryColor}20` }}>
                          <Users className="w-3 h-3" style={{ color: primaryColor }} />
                        </div>
                        <p className="text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>24</p>
                        <p className="text-[8px]" style={{ color: 'var(--text-muted)' }}>{t('breadcrumb.users')}</p>
                      </div>
                      <div className="p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                        <div className="w-5 h-5 rounded mb-1 flex items-center justify-center" style={{ background: `${secondaryColor}20` }}>
                          <Building2 className="w-3 h-3" style={{ color: secondaryColor }} />
                        </div>
                        <p className="text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>5</p>
                        <p className="text-[8px]" style={{ color: 'var(--text-muted)' }}>{t('government.kpiHospitals')}</p>
                      </div>
                      <div className="p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                        <div className="w-5 h-5 rounded mb-1 flex items-center justify-center" style={{ background: `${accentColor}20` }}>
                          <BarChart3 className="w-3 h-3" style={{ color: accentColor }} />
                        </div>
                        <p className="text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>1.2k</p>
                        <p className="text-[8px]" style={{ color: 'var(--text-muted)' }}>{t('breadcrumb.patients')}</p>
                      </div>
                    </div>

                    {/* Color swatches */}
                    <div className="p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                      <p className="text-[9px] mb-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>{t('branding.colorPalette')}</p>
                      <div className="flex gap-2">
                        <div className="flex-1 h-8 rounded-md" style={{ background: primaryColor }} />
                        <div className="flex-1 h-8 rounded-md" style={{ background: secondaryColor }} />
                        <div className="flex-1 h-8 rounded-md" style={{ background: accentColor }} />
                      </div>
                      <div className="flex gap-2 mt-1">
                        <p className="flex-1 text-center text-[8px]" style={{ color: 'var(--text-muted)' }}>{t('consultation.diagPrimary')}</p>
                        <p className="flex-1 text-center text-[8px]" style={{ color: 'var(--text-muted)' }}>{t('consultation.diagSecondary')}</p>
                        <p className="flex-1 text-center text-[8px]" style={{ color: 'var(--text-muted)' }}>{t('branding.accent')}</p>
                      </div>
                    </div>

                    {/* Button preview */}
                    <div className="flex gap-2">
                      <div className="px-3 py-1.5 rounded-md text-[9px] text-white font-medium" style={{ background: primaryColor }}>
                        {t('branding.primaryButton')}
                      </div>
                      <div className="px-3 py-1.5 rounded-md text-[9px] font-medium" style={{ background: `${secondaryColor}15`, color: secondaryColor, border: `1px solid ${secondaryColor}30` }}>
                        {t('consultation.diagSecondary')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SadbCard>
      </div>
    </SadbPage>
  );
}
