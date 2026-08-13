'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useApp } from '@/lib/context';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import type { OrganizationDoc } from '@/lib/db-types';
import {
  Plus, X, Edit3, Ban,
  ToggleLeft, ToggleRight
} from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';

type OrgFormData = {
  name: string;
  slug: string;
  orgType: 'public' | 'private';
  contactEmail: string;
  country: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  subscriptionPlan: 'basic' | 'professional' | 'enterprise';
  subscriptionStatus: 'trial' | 'active' | 'suspended' | 'cancelled';
  maxUsers: number;
  maxHospitals: number;
  epidemicIntelligence: boolean;
  mchAnalytics: boolean;
  dhis2Export: boolean;
  aiClinicalSupport: boolean;
  communityHealth: boolean;
  facilityAssessments: boolean;
};

const emptyForm: OrgFormData = {
  name: '', slug: '', orgType: 'public', contactEmail: '', country: 'South Sudan',
  primaryColor: 'var(--accent-primary)', secondaryColor: 'var(--accent-hover)', accentColor: 'var(--accent-primary)',
  subscriptionPlan: 'professional', subscriptionStatus: 'trial',
  maxUsers: 50, maxHospitals: 10,
  epidemicIntelligence: true, mchAnalytics: true, dhis2Export: false,
  aiClinicalSupport: true, communityHealth: true, facilityAssessments: true,
};

export default function AdminOrganizationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser, globalSearch, setGlobalSearch } = useApp();
  const { organizations, loading, create, update, deactivate, getStats } = useOrganizations();

  // Text search comes from the shared global search state, surfaced via this
  // page's own list header search box (the TopBar strip is gone).
  const search = globalSearch;
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OrgFormData>(emptyForm);
  const [formLoading, setFormLoading] = useState(false);
  const [orgUserCounts, setOrgUserCounts] = useState<Record<string, number>>({});

  // Access control
  useEffect(() => {
    if (currentUser && currentUser.role !== 'super_admin') {
      router.push('/dashboard');
    }
  }, [currentUser, router]);

  // Load user counts per org. Run all getStats() calls concurrently so the
  // overall wait is the slowest single call, not the sum of every call.
  useEffect(() => {
    const loadCounts = async () => {
      const entries = await Promise.all(
        organizations.map(async (org): Promise<[string, number]> => {
          try {
            const stats = await getStats(org._id);
            return [org._id, stats.userCount];
          } catch {
            return [org._id, 0];
          }
        })
      );
      const counts: Record<string, number> = {};
      for (const [id, count] of entries) counts[id] = count;
      setOrgUserCounts(counts);
    };
    if (organizations.length > 0) loadCounts();
  }, [organizations, getStats]);

  const filteredOrgs = useMemo(() => {
    return organizations.filter(o => {
      const q = search.toLowerCase();
      return !q || o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q) || o.contactEmail.toLowerCase().includes(q);
    });
  }, [organizations, search]);

  if (!currentUser || currentUser.role !== 'super_admin') return null;

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (org: OrganizationDoc) => {
    setEditingId(org._id);
    setForm({
      name: org.name,
      slug: org.slug,
      orgType: org.orgType,
      contactEmail: org.contactEmail,
      country: org.country,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      accentColor: org.accentColor || 'var(--color-warning)',
      subscriptionPlan: org.subscriptionPlan,
      subscriptionStatus: org.subscriptionStatus,
      maxUsers: org.maxUsers,
      maxHospitals: org.maxHospitals,
      epidemicIntelligence: org.featureFlags.epidemicIntelligence,
      mchAnalytics: org.featureFlags.mchAnalytics,
      dhis2Export: org.featureFlags.dhis2Export,
      aiClinicalSupport: org.featureFlags.aiClinicalSupport,
      communityHealth: org.featureFlags.communityHealth,
      facilityAssessments: org.featureFlags.facilityAssessments,
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.slug || !form.contactEmail) return;
    setFormLoading(true);
    try {
      const orgData = {
        name: form.name,
        slug: form.slug,
        orgType: form.orgType,
        contactEmail: form.contactEmail,
        country: form.country,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        accentColor: form.accentColor,
        subscriptionPlan: form.subscriptionPlan,
        subscriptionStatus: form.subscriptionStatus,
        maxUsers: form.maxUsers,
        maxHospitals: form.maxHospitals,
        isActive: true,
        featureFlags: {
          epidemicIntelligence: form.epidemicIntelligence,
          mchAnalytics: form.mchAnalytics,
          dhis2Export: form.dhis2Export,
          aiClinicalSupport: form.aiClinicalSupport,
          communityHealth: form.communityHealth,
          facilityAssessments: form.facilityAssessments,
        },
      };

      if (editingId) {
        await update(editingId, orgData, currentUser._id, currentUser.username);
      } else {
        await create(orgData as Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>, currentUser._id, currentUser.username);
      }
      setShowForm(false);
    } catch (err) {
      console.error(err);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (org: OrganizationDoc) => {
    if (!confirm(t('orgAdmin.confirmDeactivate', { name: org.name }))) return;
    try {
      await deactivate(org._id, currentUser._id, currentUser.username);
    } catch (err) {
      console.error(err);
    }
  };

  // Styles
  const inputStyle: React.CSSProperties = {
    background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
    borderRadius: '4px', padding: '10px 14px', color: 'var(--text-primary)',
    fontSize: '14px', width: '100%', outline: 'none',
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none' as const, paddingRight: '36px',
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238A9E9A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', display: 'block',
  };

  return (
    <>
      <main className="page-container page-enter admin-detail-page" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

        {/* Table */}
        <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('orgAdmin.title')}
            search={{ value: search, onChange: setGlobalSearch, placeholder: t('orgAdmin.searchPlaceholder') }}
            actions={
              <button onClick={openCreate} className="btn btn-primary" style={{ height: 38, whiteSpace: 'nowrap' }}>
                <Plus className="w-4 h-4" /> {t('orgAdmin.newOrganization')}
              </button>
            }
          />
          <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <table className="w-full" style={{ minWidth: 840 }}>
              <thead>
                <tr>
                  {[
                    { key: 'name', label: t('orgAdmin.colName') },
                    { key: 'slug', label: t('orgAdmin.colSlug') },
                    { key: 'type', label: t('orgAdmin.colType') },
                    { key: 'plan', label: t('orgAdmin.colPlan') },
                    { key: 'status', label: t('orgAdmin.colStatus') },
                    { key: 'users', label: t('orgAdmin.colUsers') },
                    { key: 'actions', label: t('orgAdmin.colActions') },
                  ].map(h => (
                    <th key={h.key} className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('orgAdmin.loading')}</td></tr>
                ) : filteredOrgs.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('orgAdmin.empty')}</td></tr>
                ) : filteredOrgs.map(org => (
                  <tr key={org._id} style={{ borderBottom: '1px solid var(--border-light)' }} className="transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: org.primaryColor }}>
                          {org.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium" style={{ color: org.isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}>{org.name}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{org.contactEmail}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs px-2 py-1 rounded" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)' }}>{org.slug}</code>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-full" style={{
                        background: org.orgType === 'public' ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.1)',
                        color: org.orgType === 'public' ? 'var(--color-success-text)' : 'var(--color-danger-text)',
                      }}>{org.orgType}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{
                        background: org.subscriptionPlan === 'enterprise' ? 'rgba(124,58,237,0.12)' : org.subscriptionPlan === 'professional' ? 'rgba(33, 145, 208, 0.12)' : 'rgba(107,114,128,0.12)',
                        color: org.subscriptionPlan === 'enterprise' ? 'var(--accent-primary)' : org.subscriptionPlan === 'professional' ? 'var(--accent-primary)' : '#6B7280',
                      }}>{org.subscriptionPlan}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <span className="w-2 h-2 rounded-full" style={{
                          background: org.subscriptionStatus === 'active' ? 'var(--color-success)' : org.subscriptionStatus === 'trial' ? 'var(--color-warning)' : 'var(--color-danger)',
                        }} />
                        <span style={{
                          color: org.subscriptionStatus === 'active' ? 'var(--color-success-text)' : org.subscriptionStatus === 'trial' ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
                        }}>{org.subscriptionStatus}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {orgUserCounts[org._id] ?? '...'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <RowActionsMenu
                          actions={[
                            { key: 'edit', label: t('action.edit'), icon: <Edit3 className="w-4 h-4" />, onClick: () => openEdit(org) },
                            ...(org.isActive ? [{ key: 'deactivate', label: t('orgAdmin.deactivate'), tone: 'danger' as const, icon: <Ban className="w-4 h-4" />, onClick: () => handleDeactivate(org) }] : []),
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Create/Edit Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
        }} onClick={() => setShowForm(false)}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-light)',
            borderRadius: '6px', width: '100%', maxWidth: '680px', maxHeight: '90vh',
            overflow: 'auto', padding: '28px',
          }} onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {editingId ? t('orgAdmin.editOrganization') : t('orgAdmin.createOrganization')}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Basic Info */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--color-danger-text)' }}>{t('orgAdmin.sectionBasicInfo')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label style={labelStyle}>{t('orgAdmin.labelName')}</label>
                    <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder={t('orgAdmin.placeholderName')} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelSlug')}</label>
                    <input type="text" value={form.slug}
                      onChange={e => setForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      placeholder={t('orgAdmin.placeholderSlug')} style={inputStyle} disabled={!!editingId} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelOrgType')}</label>
                    <Select value={form.orgType} onChange={e => setForm(p => ({ ...p, orgType: e.target.value as 'public' | 'private' }))} style={selectStyle}>
                      <option value="public">{t('orgAdmin.typePublic')}</option>
                      <option value="private">{t('orgAdmin.typePrivate')}</option>
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelContactEmail')}</label>
                    <input type="email" value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))}
                      placeholder="support.tamam@gmail.com" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelCountry')}</label>
                    <input type="text" value={form.country} onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                      style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* Subscription */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--color-danger-text)' }}>{t('orgAdmin.sectionSubscription')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelPlan')}</label>
                    <Select value={form.subscriptionPlan} onChange={e => setForm(p => ({ ...p, subscriptionPlan: e.target.value as OrgFormData['subscriptionPlan'] }))} style={selectStyle}>
                      <option value="basic">{t('orgAdmin.planBasic')}</option>
                      <option value="professional">{t('orgAdmin.planProfessional')}</option>
                      <option value="enterprise">{t('orgAdmin.planEnterprise')}</option>
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelStatus')}</label>
                    <Select value={form.subscriptionStatus} onChange={e => setForm(p => ({ ...p, subscriptionStatus: e.target.value as OrgFormData['subscriptionStatus'] }))} style={selectStyle}>
                      <option value="trial">{t('orgAdmin.statusTrial')}</option>
                      <option value="active">{t('orgAdmin.statusActive')}</option>
                      <option value="suspended">{t('orgAdmin.statusSuspended')}</option>
                      <option value="cancelled">{t('orgAdmin.statusCancelled')}</option>
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelMaxUsers')}</label>
                    <input type="number" min="1" value={form.maxUsers} onChange={e => setForm(p => ({ ...p, maxUsers: parseInt(e.target.value) || 1 }))} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelMaxHospitals')}</label>
                    <input type="number" min="1" value={form.maxHospitals} onChange={e => setForm(p => ({ ...p, maxHospitals: parseInt(e.target.value) || 1 }))} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* Branding */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--color-danger-text)' }}>{t('orgAdmin.sectionBranding')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { key: 'primaryColor' as const, label: t('orgAdmin.colorPrimary') },
                    { key: 'secondaryColor' as const, label: t('orgAdmin.colorSecondary') },
                    { key: 'accentColor' as const, label: t('orgAdmin.colorAccent') },
                  ].map(c => (
                    <div key={c.key}>
                      <label style={labelStyle}>{c.label}</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={form[c.key]} onChange={e => setForm(p => ({ ...p, [c.key]: e.target.value }))}
                          className="w-10 h-10 rounded-lg cursor-pointer border-0" />
                        <input type="text" value={form[c.key]} onChange={e => setForm(p => ({ ...p, [c.key]: e.target.value }))}
                          style={{ ...inputStyle, fontFamily: 'var(--font-platform-mono)', fontSize: '12px' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Feature Flags */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--color-danger-text)' }}>{t('orgAdmin.sectionFeatureFlags')}</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {[
                    { key: 'epidemicIntelligence' as const, label: t('orgAdmin.featureEpidemicIntelligence') },
                    { key: 'mchAnalytics' as const, label: t('orgAdmin.featureMchAnalytics') },
                    { key: 'dhis2Export' as const, label: t('orgAdmin.featureDhis2Export') },
                    { key: 'aiClinicalSupport' as const, label: t('orgAdmin.featureAiClinicalSupport') },
                    { key: 'communityHealth' as const, label: t('orgAdmin.featureCommunityHealth') },
                    { key: 'facilityAssessments' as const, label: t('orgAdmin.featureFacilityAssessments') },
                  ].map(ff => (
                    <label key={ff.key} className="flex items-center gap-3 cursor-pointer text-sm" style={{ color: 'var(--text-primary)' }}>
                      <button type="button" onClick={() => setForm(p => ({ ...p, [ff.key]: !p[ff.key] }))}
                        className="flex-shrink-0">
                        {form[ff.key] ? (
                          <ToggleRight className="w-8 h-8" style={{ color: 'var(--color-danger)' }} />
                        ) : (
                          <ToggleLeft className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
                        )}
                      </button>
                      {ff.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
                <button onClick={() => setShowForm(false)} className="px-5 py-2.5 rounded-xl text-sm font-medium" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}>
                  {t('action.cancel')}
                </button>
                <button onClick={handleSubmit} disabled={formLoading} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--color-danger)', opacity: formLoading ? 0.6 : 1 }}>
                  {formLoading ? t('orgAdmin.saving') : editingId ? t('orgAdmin.updateOrganization') : t('orgAdmin.createOrganization')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
