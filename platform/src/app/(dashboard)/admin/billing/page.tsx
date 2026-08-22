'use client';

/**
 * Super-admin → Billing & Subscriptions (sadb-* design language, migrated
 * per docs/SUPER-ADMIN-DESIGN-PLAN.md § Phase 4). KPI strip + a searchable,
 * filterable tenant table with inline row editing for plan / status / seat
 * limits — the table IS the editor, no separate form. Writes go through
 * useOrganizations().update with the acting super-admin attributed.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useToast } from '@/components/Toast';
import type { OrganizationDoc } from '@/lib/db-types';
import {
  SadbPage, SadbKpiTile, SadbCard, SadbSearch, SadbChip, SadbActionButton,
  statusChip, type ChipTone,
} from '@/components/admin/sadb-ui';
import { SaTable } from '@/components/admin/sa-ui';
import { EhrListFilters } from '@/components/ehr/EhrListHeader';
import { Edit3 } from '@/components/icons/lucide';
import Select from '@/components/Select';

// Shared control styling inside the header's Filters popover.
const filterFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

// Inline row-edit controls reuse the design's modal-input look, sized down
// to fit a dense table row (the modal's own 40px min-height reads as
// oversized inside a <td>).
const editInputStyle: CSSProperties = { height: 30, minHeight: 30, padding: '4px 8px', fontSize: 12.5 };

// The kit's five chip tones don't stretch to three subscription tiers 1:1 —
// basic reads as the plain/neutral tier, professional and enterprise both
// read as the "paid, elevated" blue tier (previously the only difference
// between them was a purple-vs-blue background tint on an otherwise
// identical chip; that distinction wasn't carrying information on its own).
const PLAN_CHIP: Record<OrganizationDoc['subscriptionPlan'], ChipTone> = {
  basic: 'neutral', professional: 'blue', enterprise: 'blue',
};

export default function AdminBillingPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { organizations, loading, update } = useOrganizations();
  const { showToast } = useToast();

  // Local to this page — the previous binding to the shared app-wide search
  // state leaked whatever was typed here into every other module's search box.
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState<OrganizationDoc['subscriptionPlan']>('basic');
  const [editStatus, setEditStatus] = useState<OrganizationDoc['subscriptionStatus']>('trial');
  const [editMaxUsers, setEditMaxUsers] = useState(50);
  const [editMaxHospitals, setEditMaxHospitals] = useState(10);
  const [saving, setSaving] = useState(false);

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return organizations.filter(o => {
      if (q && !o.name.toLowerCase().includes(q) && !o.slug.toLowerCase().includes(q)) return false;
      if (planFilter && o.subscriptionPlan !== planFilter) return false;
      if (statusFilter && o.subscriptionStatus !== statusFilter) return false;
      return true;
    });
  }, [organizations, search, planFilter, statusFilter]);

  /** Per-plan counts for the filter option labels — kept visible at the
   *  point of use, same numbers the old static plan-breakdown card showed. */
  const planCounts = useMemo(() => ({
    basic: organizations.filter(o => o.subscriptionPlan === 'basic').length,
    professional: organizations.filter(o => o.subscriptionPlan === 'professional').length,
    enterprise: organizations.filter(o => o.subscriptionPlan === 'enterprise').length,
  }), [organizations]);

  const startEdit = (org: OrganizationDoc) => {
    setEditingId(org._id);
    setEditPlan(org.subscriptionPlan);
    setEditStatus(org.subscriptionStatus);
    setEditMaxUsers(org.maxUsers);
    setEditMaxHospitals(org.maxHospitals);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (org: OrganizationDoc) => {
    setSaving(true);
    try {
      await update(org._id, {
        subscriptionPlan: editPlan,
        subscriptionStatus: editStatus,
        maxUsers: editMaxUsers,
        maxHospitals: editMaxHospitals,
      }, currentUser?._id, currentUser?.username);
      setEditingId(null);
      showToast(`Saved subscription changes for ${org.name}.`, 'success');
    } catch (err) {
      console.error('Failed to save organization billing changes:', err);
      showToast(err instanceof Error ? err.message : `Failed to save changes for ${org.name}.`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const totalActive = organizations.filter(o => o.subscriptionStatus === 'active').length;
  const totalTrial = organizations.filter(o => o.subscriptionStatus === 'trial').length;
  const totalSuspended = organizations.filter(o => o.subscriptionStatus === 'suspended').length;
  const totalMaxUsers = organizations.reduce((sum, o) => sum + o.maxUsers, 0);

  const activeFilterCount = (planFilter ? 1 : 0) + (statusFilter ? 1 : 0);

  return (
    <SadbPage>
      <div className="sadb-kpi-row">
        <SadbKpiTile
          label={t('adminBilling.kpiActiveSubscriptions')}
          value={totalActive}
          delta={`of ${organizations.length} organizations`}
          deltaTone={totalActive > 0 ? 'up' : undefined}
        />
        <SadbKpiTile
          label={t('adminBilling.kpiTrialOrganizations')}
          value={totalTrial}
          delta={totalTrial > 0 ? 'Needs conversion follow-up' : 'None currently'}
          deltaTone={totalTrial > 0 ? 'warn' : undefined}
        />
        <SadbKpiTile
          label={t('adminBilling.kpiSuspended')}
          value={totalSuspended}
          delta={totalSuspended > 0 ? 'Review and reconcile' : 'None suspended'}
          deltaTone={totalSuspended > 0 ? 'warn' : undefined}
        />
        <SadbKpiTile
          label={t('adminBilling.kpiTotalLicensedUsers')}
          value={totalMaxUsers}
          delta={`across ${organizations.length} organizations`}
        />
      </div>

      <SadbCard
        title={t('adminBilling.title')}
        meta={(
          <div className="sadb-legend">
            <span><i style={{ background: 'var(--color-success-800)' }} />{t('adminBilling.statusActive')} ({totalActive})</span>
            <span><i style={{ background: 'var(--color-warning-600)' }} />{t('adminBilling.statusTrial')} ({totalTrial})</span>
            <span><i style={{ background: 'var(--text-muted)' }} />{t('adminBilling.statusSuspended')} ({totalSuspended})</span>
          </div>
        )}
      >
        <div className="sadb-search-row">
          <SadbSearch value={search} onChange={setSearch} placeholder={t('adminBilling.searchPlaceholder')} />
          <EhrListFilters
            activeCount={activeFilterCount}
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
        </div>

        <SaTable
          columns={[
            { label: t('adminBilling.colOrganization'), w: 2.2 },
            { label: t('adminBilling.colPlan'), w: 1 },
            { label: t('adminBilling.colStatus'), w: 1 },
            { label: t('adminBilling.colMaxUsers'), w: 0.8 },
            { label: t('adminBilling.colMaxHospitals'), w: 0.9 },
            { label: t('adminBilling.colActions'), w: 1 },
          ]}
          empty={loading ? t('status.loading') : t('adminBilling.noOrganizationsFound')}
          minWidth={720}
        >
          {filteredOrgs.map(org => {
            const isEditing = editingId === org._id;
            return (
              <tr key={org._id}>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: org.primaryColor }}>
                      {org.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{org.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{org.country}</p>
                    </div>
                  </div>
                </td>
                <td>
                  {isEditing ? (
                    <Select
                      value={editPlan}
                      onChange={e => setEditPlan(e.target.value as OrganizationDoc['subscriptionPlan'])}
                      className="sadb-modal-input"
                      style={editInputStyle}
                      aria-label={`${org.name} plan`}
                    >
                      <option value="basic">{t('adminBilling.planBasic')}</option>
                      <option value="professional">{t('adminBilling.planProfessional')}</option>
                      <option value="enterprise">{t('adminBilling.planEnterprise')}</option>
                    </Select>
                  ) : (
                    <SadbChip tone={PLAN_CHIP[org.subscriptionPlan]}>{org.subscriptionPlan}</SadbChip>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <Select
                      value={editStatus}
                      onChange={e => setEditStatus(e.target.value as OrganizationDoc['subscriptionStatus'])}
                      className="sadb-modal-input"
                      style={editInputStyle}
                      aria-label={`${org.name} status`}
                    >
                      <option value="trial">{t('adminBilling.statusTrial')}</option>
                      <option value="active">{t('adminBilling.statusActive')}</option>
                      <option value="suspended">{t('adminBilling.statusSuspended')}</option>
                      <option value="cancelled">{t('adminBilling.statusCancelled')}</option>
                    </Select>
                  ) : (
                    <SadbChip tone={statusChip(org.subscriptionStatus)}>{org.subscriptionStatus}</SadbChip>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      type="number"
                      min="1"
                      value={editMaxUsers}
                      onChange={e => setEditMaxUsers(parseInt(e.target.value) || 1)}
                      className="sadb-modal-input"
                      style={{ ...editInputStyle, width: 80 }}
                      aria-label={`${org.name} max users`}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>{org.maxUsers}</span>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <input
                      type="number"
                      min="1"
                      value={editMaxHospitals}
                      onChange={e => setEditMaxHospitals(parseInt(e.target.value) || 1)}
                      className="sadb-modal-input"
                      style={{ ...editInputStyle, width: 80 }}
                      aria-label={`${org.name} max hospitals`}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>{org.maxHospitals}</span>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <SadbActionButton onClick={() => saveEdit(org)} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </SadbActionButton>
                      <SadbActionButton onClick={cancelEdit} disabled={saving}>Cancel</SadbActionButton>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(org)}
                      aria-label={`Edit ${org.name}`}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </SaTable>
      </SadbCard>
    </SadbPage>
  );
}
