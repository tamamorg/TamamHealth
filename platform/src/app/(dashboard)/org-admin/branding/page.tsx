'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  Palette, Save, Upload, X, Eye, RotateCcw, Building2, Users,
  LayoutDashboard, BarChart3, Settings, MessageSquare,
} from '@/components/icons/lucide';
import type { OrganizationDoc } from '@/lib/db-types';
import EhrListHeader from '@/components/ehr/EhrListHeader';

export default function OrgBrandingPage() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const [org, setOrg] = useState<OrganizationDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Form state
  const [orgName, setOrgName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('var(--accent-primary)');
  const [secondaryColor, setSecondaryColor] = useState('var(--accent-hover)');
  const [accentColor, setAccentColor] = useState('var(--accent-primary)');
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
  const [bankDetails, setBankDetails] = useState('');

  const brandColor = primaryColor || 'var(--accent-primary)';

  useEffect(() => {
    if (!currentUser?.orgId) return;
    const load = async () => {
      try {
        const { getOrganizationById } = await import('@/lib/services/organization-service');
        const o = await getOrganizationById(currentUser.orgId!);
        if (o) {
          setOrg(o);
          setOrgName(o.name);
          setPrimaryColor(o.primaryColor || 'var(--accent-primary)');
          setSecondaryColor(o.secondaryColor || 'var(--accent-hover)');
          setAccentColor(o.accentColor || 'var(--accent-primary)');
          setLogoUrl(o.logoUrl);
          setBankDetails(o.bankDetails || '');
        }
      } catch (err) {
        console.error('Failed to load org:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentUser?.orgId]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512000) {
      setError(t('branding.errorLogoSize'));
      setTimeout(() => setError(''), 4000);
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!org || !currentUser?.orgId) return;
    if (!orgName.trim()) {
      setError(t('branding.errorNameRequired'));
      setTimeout(() => setError(''), 4000);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { updateOrganization } = await import('@/lib/services/organization-service');
      await updateOrganization(
        currentUser.orgId,
        {
          name: orgName.trim(),
          primaryColor,
          secondaryColor,
          accentColor,
          logoUrl,
          bankDetails: bankDetails.trim(),
        },
        currentUser._id,
        currentUser.username
      );

      // Apply branding CSS variables live
      const { brandingToCSSVars } = await import('@/lib/branding');
      const vars = brandingToCSSVars({
        name: orgName.trim(),
        logoUrl,
        primaryColor,
        secondaryColor,
        accentColor,
      });
      for (const [key, value] of Object.entries(vars)) {
        document.documentElement.style.setProperty(key, value);
      }

      setSuccess(t('branding.savedSuccess'));
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || t('branding.errorSave'));
      setTimeout(() => setError(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!org) return;
    setOrgName(org.name);
    setPrimaryColor(org.primaryColor || 'var(--accent-primary)');
    setSecondaryColor(org.secondaryColor || 'var(--accent-hover)');
    setAccentColor(org.accentColor || 'var(--accent-primary)');
    setLogoUrl(org.logoUrl);
    setBankDetails(org.bankDetails || '');
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

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: brandColor }} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="page-container page-enter">
        <div className="dash-card overflow-hidden mb-4">
          <EhrListHeader
            title={t('branding.title')}
            actions={
              <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('branding.reset')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: brandColor }}
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {t('appointments.saveChanges')}
                </button>
              </div>
            }
          />
        </div>
        {/* Banners */}
        {success && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border)' }}>
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium" style={{ background: 'rgba(229,46,66,0.1)', color: 'var(--color-danger-text)', border: '1px solid rgba(229,46,66,0.2)' }}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Editor Panel */}
          <div className="space-y-5">
            {/* Organization Name */}
            <div className="dash-card p-4">
              <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('branding.orgName')}
              </label>
              <input
                type="text"
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              />
            </div>

            {/* Bank Transfer Details */}
            <div className="dash-card p-4">
              <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('branding.bankDetails')}
              </label>
              <textarea
                value={bankDetails}
                onChange={e => setBankDetails(e.target.value)}
                rows={4}
                placeholder={t('branding.bankDetailsPlaceholder')}
                className="w-full px-3 py-2 rounded-lg text-sm font-mono resize-y"
                style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              />
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {t('branding.bankDetailsHint')}
              </p>
            </div>

            {/* Logo */}
            <div className="dash-card p-4">
              <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('branding.logo')}
              </label>
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={t('branding.logo')}
                      className="w-16 h-16 rounded-lg object-cover"
                      style={{ border: '2px solid var(--border-light)' }}
                    />
                    <button
                      onClick={() => setLogoUrl(undefined)}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--color-danger)', color: '#fff' }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    className="w-16 h-16 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--overlay-subtle)', border: '2px dashed var(--border-light)' }}
                  >
                    <Upload className="w-6 h-6" style={{ color: 'var(--text-muted)' }} />
                  </div>
                )}
                <div>
                  <label
                    className="cursor-pointer flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                    style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {t('branding.uploadLogo')}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t('branding.logoHint')}
                  </p>
                </div>
              </div>
            </div>

            {/* Color Pickers */}
            <div className="dash-card overflow-hidden">
              <div className="flex items-center gap-2 p-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <Palette className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('branding.brandColors')}</h3>
              </div>
              <div className="p-4 space-y-4">
                {/* Primary */}
                <div>
                  <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('branding.primaryColor')}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={e => setPrimaryColor(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                      style={{ background: 'transparent' }}
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={e => setPrimaryColor(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
                      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                    />
                    <div className="w-8 h-8 rounded-lg" style={{ background: primaryColor }} />
                  </div>
                </div>

                {/* Secondary */}
                <div>
                  <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('branding.secondaryColor')}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={e => setSecondaryColor(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                      style={{ background: 'transparent' }}
                    />
                    <input
                      type="text"
                      value={secondaryColor}
                      onChange={e => setSecondaryColor(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
                      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                    />
                    <div className="w-8 h-8 rounded-lg" style={{ background: secondaryColor }} />
                  </div>
                </div>

                {/* Accent */}
                <div>
                  <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {t('branding.accentColor')}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={e => setAccentColor(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                      style={{ background: 'transparent' }}
                    />
                    <input
                      type="text"
                      value={accentColor}
                      onChange={e => setAccentColor(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
                      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                    />
                    <div className="w-8 h-8 rounded-lg" style={{ background: accentColor }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div>
            <div className="dash-card overflow-hidden">
              <div className="flex items-center gap-2 p-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <Eye className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('branding.livePreview')}</h3>
              </div>
              <div className="p-4">

              {/* Simulated sidebar + header */}
              <div className="rounded-xl overflow-hidden shadow-lg" style={{ border: '1px solid var(--border-light)' }}>
                <div className="flex" style={{ height: 360 }}>
                  {/* Sidebar preview */}
                  <div className="w-[200px] flex flex-col" style={{ background: '#0B0F1A' }}>
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
                              borderLeft: item.active ? `2px solid ${primaryColor}` : '2px solid transparent',
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
                      <div className="ml-auto flex items-center gap-2">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
