'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import type { OrganizationDoc } from '@/lib/db-types';
import DataTile from '@/components/DataTile';
import EhrListHeader, { EhrListFilters, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import {
  Edit3, Check, X,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

// Shared control styling inside the header's Filters popover.
const filterFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

export default function AdminBillingPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser, globalSearch, setGlobalSearch } = useApp();
  const { organizations, loading, update } = useOrganizations();

  // Text search comes from the shared global search state, surfaced via this
  // page's own list header search box (the TopBar strip is gone).
  const search = globalSearch;
  // Plan / status filters live in the list header's Filters popover. These
  // replace the old "Active Subscriptions by Plan" card — a static breakdown
  // you could read but not act on. As filters the same numbers are still
  // visible (see the option counts below) and clicking one narrows the table.
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState<'basic' | 'professional' | 'enterprise'>('basic');
  const [editStatus, setEditStatus] = useState<'trial' | 'active' | 'suspended' | 'cancelled'>('trial');
  const [editMaxUsers, setEditMaxUsers] = useState(50);
  const [editMaxHospitals, setEditMaxHospitals] = useState(10);
  const [saving, setSaving] = useState(false);

  // Access control
  useEffect(() => {
    if (currentUser && currentUser.role !== 'super_admin') {
      router.push('/dashboard');
    }
  }, [currentUser, router]);

  const filteredOrgs = useMemo(() => {
    const q = search.toLowerCase();
    return organizations.filter(o => {
      if (q && !o.name.toLowerCase().includes(q) && !o.slug.toLowerCase().includes(q)) return false;
      if (planFilter && o.subscriptionPlan !== planFilter) return false;
      if (statusFilter && o.subscriptionStatus !== statusFilter) return false;
      return true;
    });
  }, [organizations, search, planFilter, statusFilter]);

  /** Per-plan counts for the filter option labels — the numbers the deleted
   *  breakdown card used to show, kept visible at the point of use. */
  const planCounts = useMemo(() => ({
    basic: organizations.filter(o => o.subscriptionPlan === 'basic').length,
    professional: organizations.filter(o => o.subscriptionPlan === 'professional').length,
    enterprise: organizations.filter(o => o.subscriptionPlan === 'enterprise').length,
  }), [organizations]);

  if (!currentUser || currentUser.role !== 'super_admin') return null;

  const startEdit = (org: OrganizationDoc) => {
    setEditingId(org._id);
    setEditPlan(org.subscriptionPlan);
    setEditStatus(org.subscriptionStatus);
    setEditMaxUsers(org.maxUsers);
    setEditMaxHospitals(org.maxHospitals);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (orgId: string) => {
    setSaving(true);
    try {
      await update(orgId, {
        subscriptionPlan: editPlan,
        subscriptionStatus: editStatus,
        maxUsers: editMaxUsers,
        maxHospitals: editMaxHospitals,
      }, currentUser._id, currentUser.username);
      setEditingId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const totalActive = organizations.filter(o => o.subscriptionStatus === 'active').length;
  const totalTrial = organizations.filter(o => o.subscriptionStatus === 'trial').length;
  const totalSuspended = organizations.filter(o => o.subscriptionStatus === 'suspended').length;
  const totalMaxUsers = organizations.reduce((sum, o) => sum + o.maxUsers, 0);

  const inputStyle: React.CSSProperties = {
    background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
    borderRadius: '4px', padding: '6px 10px', color: 'var(--text-primary)',
    fontSize: '13px', outline: 'none',
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none' as const, paddingRight: '28px',
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238A9E9A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
  };

  return (
    <>
      <main className="page-container page-enter admin-detail-page" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <DataTile label={t('adminBilling.kpiActiveSubscriptions')} value={totalActive} tone={totalActive > 0 ? 'ok' : 'default'} />
          <DataTile label={t('adminBilling.kpiTrialOrganizations')} value={totalTrial} tone={totalTrial > 0 ? 'warning' : 'default'} />
          <DataTile label={t('adminBilling.kpiSuspended')} value={totalSuspended} tone={totalSuspended > 0 ? 'danger' : 'default'} />
          <DataTile label={t('adminBilling.kpiTotalLicensedUsers')} value={totalMaxUsers} />
        </div>

        {/* Table */}
        <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('adminBilling.title')}
            stats={[
              { label: t('adminBilling.statusActive'), value: totalActive, color: LIST_STAT_COLORS.green },
              { label: t('adminBilling.statusTrial'), value: totalTrial, color: LIST_STAT_COLORS.amber },
              { label: t('adminBilling.statusSuspended'), value: totalSuspended, color: LIST_STAT_COLORS.muted },
            ]}
            search={{ value: search, onChange: setGlobalSearch, placeholder: t('adminBilling.searchPlaceholder') }}
            actions={
              <EhrListFilters
                activeCount={(planFilter ? 1 : 0) + (statusFilter ? 1 : 0)}
                onClear={() => { setPlanFilter(''); setStatusFilter(''); }}
                panelWidth={260}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('adminBilling.colPlan')}</span>
                  <Select value={planFilter} onChange={e => setPlanFilter(e.target.value)} className="w-full text-sm py-2 px-3" style={filterFieldStyle}>
                    <option value="">{t('adminBilling.planAll')}</option>
                    <option value="enterprise">{t('adminBilling.planEnterprise')} ({planCounts.enterprise})</option>
                    <option value="professional">{t('adminBilling.planProfessional')} ({planCounts.professional})</option>
                    <option value="basic">{t('adminBilling.planBasic')} ({planCounts.basic})</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('adminBilling.colStatus')}</span>
                  <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full text-sm py-2 px-3" style={filterFieldStyle}>
                    <option value="">{t('adminBilling.statusAll')}</option>
                    <option value="active">{t('adminBilling.statusActive')} ({totalActive})</option>
                    <option value="trial">{t('adminBilling.statusTrial')} ({totalTrial})</option>
                    <option value="suspended">{t('adminBilling.statusSuspended')} ({totalSuspended})</option>
                  </Select>
                </label>
              </EhrListFilters>
            }
          />
          <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <table className="w-full" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  {[
                    { key: 'organization', label: t('adminBilling.colOrganization') },
                    { key: 'plan', label: t('adminBilling.colPlan') },
                    { key: 'status', label: t('adminBilling.colStatus') },
                    { key: 'maxUsers', label: t('adminBilling.colMaxUsers') },
                    { key: 'maxHospitals', label: t('adminBilling.colMaxHospitals') },
                    { key: 'actions', label: t('adminBilling.colActions') },
                  ].map(h => (
                    <th key={h.key} className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('status.loading')}</td></tr>
                ) : filteredOrgs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('adminBilling.noOrganizationsFound')}</td></tr>
                ) : filteredOrgs.map(org => {
                  const isEditing = editingId === org._id;
                  return (
                    <tr key={org._id} style={{ borderBottom: '1px solid var(--border-light)' }} className="transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: org.primaryColor }}>
                            {org.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{org.name}</p>
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{org.country}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Select value={editPlan} onChange={e => setEditPlan(e.target.value as typeof editPlan)} style={selectStyle}>
                            <option value="basic">{t('adminBilling.planBasic')}</option>
                            <option value="professional">{t('adminBilling.planProfessional')}</option>
                            <option value="enterprise">{t('adminBilling.planEnterprise')}</option>
                          </Select>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{
                            background: org.subscriptionPlan === 'enterprise' ? 'rgba(124,58,237,0.12)' : org.subscriptionPlan === 'professional' ? 'rgba(33, 145, 208, 0.12)' : 'rgba(107,114,128,0.12)',
                            color: org.subscriptionPlan === 'enterprise' ? 'var(--accent-primary)' : org.subscriptionPlan === 'professional' ? 'var(--accent-primary)' : '#6B7280',
                          }}>{org.subscriptionPlan}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Select value={editStatus} onChange={e => setEditStatus(e.target.value as typeof editStatus)} style={selectStyle}>
                            <option value="trial">{t('adminBilling.statusTrial')}</option>
                            <option value="active">{t('adminBilling.statusActive')}</option>
                            <option value="suspended">{t('adminBilling.statusSuspended')}</option>
                            <option value="cancelled">{t('adminBilling.statusCancelled')}</option>
                          </Select>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs font-semibold">
                            <span className="w-2 h-2 rounded-full" style={{
                              background: org.subscriptionStatus === 'active' ? 'var(--color-success)' : org.subscriptionStatus === 'trial' ? 'var(--color-warning)' : 'var(--color-danger)',
                            }} />
                            <span style={{
                              color: org.subscriptionStatus === 'active' ? 'var(--color-success-text)' : org.subscriptionStatus === 'trial' ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
                            }}>{org.subscriptionStatus}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input type="number" min="1" value={editMaxUsers} onChange={e => setEditMaxUsers(parseInt(e.target.value) || 1)} style={{ ...inputStyle, width: '80px' }} />
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{org.maxUsers}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input type="number" min="1" value={editMaxHospitals} onChange={e => setEditMaxHospitals(parseInt(e.target.value) || 1)} style={{ ...inputStyle, width: '80px' }} />
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{org.maxHospitals}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => saveEdit(org._id)} disabled={saving} aria-label="Save" className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-success-text)' }}>
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={cancelEdit} aria-label="Cancel" className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-danger-text)' }}>
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(org)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}>
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
