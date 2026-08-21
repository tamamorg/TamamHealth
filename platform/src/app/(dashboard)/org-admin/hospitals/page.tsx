'use client';

/**
 * The facility registry — the canonical place a facility is created.
 *
 * Two long-standing gaps are fixed here:
 *  • The create form used to live only on this page, which had no nav row, so
 *    the whole step was reachable only three levels deep in Settings. The form
 *    now lives in `CreateFacilityModal` and is opened from the network
 *    directory (`/hospitals`), the global Add menu, and here.
 *  • `loadData` returned early when the signed-in account had no `orgId` —
 *    which is exactly the platform operator — and never cleared `loading`, so
 *    a super_admin opening this page got a spinner that never resolved.
 *    Facility scoping is `filterByScope`'s job, not this component's.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useApp } from '@/lib/context';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import {
  Building2, Plus, MapPin, Users,
} from '@/components/icons/lucide';
import type { HospitalDoc, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import CreateFacilityModal from '@/components/admin/CreateFacilityModal';
import { FACILITY_TYPES } from '@/lib/facility-types';
import { canCreateFacilities } from '@/lib/people-nav';

export default function OrgHospitalsPage() {
  const { t } = useTranslation();
  const { currentUser, globalSearch, setGlobalSearch } = useApp();
  const [hospitals, setHospitals] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const brandColor = currentUser?.branding?.primaryColor || 'var(--accent-primary)';
  const mayCreate = canCreateFacilities(currentUser?.role ?? '');
  // Only a platform operator (no orgId of their own) is asked which tenant a
  // facility belongs to; loading the tenant list for anyone else is a wasted
  // read of a database they are scoped out of anyway.
  const needsOrgPicker = mayCreate && !currentUser?.orgId;
  const { organizations } = useOrganizations();

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const scope: DataScope = {
        orgId: currentUser.orgId,
        role: currentUser.role as UserRole,
      };
      const { getAllHospitals } = await import('@/lib/services/hospital-service');
      setHospitals(await getAllHospitals(scope));
    } catch (err) {
      console.error('Failed to load hospitals:', err);
      setError(t('orgHospitals.errCreateFailed'));
    } finally {
      setLoading(false);
    }
  }, [currentUser, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // Deep link: `?new=1` (the Add menu, the "no facilities yet" prompt on the
  // user form) opens the create dialog directly.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('new')) setShowCreateModal(true);
  }, []);

  const handleCreated = useCallback(async (hospital: HospitalDoc) => {
    setShowCreateModal(false);
    setError('');
    setSuccess(t('orgHospitals.successCreated', { name: hospital.name }));
    await loadData();
    setTimeout(() => setSuccess(''), 4000);
  }, [loadData, t]);

  const filteredHospitals = useMemo(() => hospitals.filter(h => {
    if (!globalSearch) return true;
    const q = globalSearch.toLowerCase();
    return (
      h.name.toLowerCase().includes(q)
      || h.state.toLowerCase().includes(q)
      || (h.town || '').toLowerCase().includes(q)
      || h.facilityType.toLowerCase().includes(q)
    );
  }), [hospitals, globalSearch]);

  const facilityLabel = (ft: string) => {
    const match = FACILITY_TYPES.find(f => f.value === ft);
    return match ? t(match.labelKey) : ft;
  };

  const facilityColor = (ft: string) => {
    const map: Record<string, string> = {
      national_referral: 'var(--color-danger)',
      state_hospital: 'var(--accent-primary)',
      county_hospital: 'var(--accent-primary)',
      phcc: 'var(--accent-primary)',
      phcu: '#2191D0',
    };
    return map[ft] || '#6B7F96';
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: brandColor }} />
      </div>
    );
  }

  const addButton = mayCreate ? (
    <button
      onClick={() => { setError(''); setShowCreateModal(true); }}
      data-tour="org-hospitals-add"
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
      style={{ background: brandColor, height: 38, whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      <Plus className="w-4 h-4" />
      {t('orgHospitals.addFacility')}
    </button>
  ) : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {success && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium" role="status" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border)' }}>
            {success}
          </div>
        )}
        {error && !showCreateModal && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium" role="alert" style={{ background: 'rgba(224, 49, 39,0.1)', color: 'var(--color-danger-text)', border: '1px solid rgba(224, 49, 39,0.2)' }}>
            {error}
          </div>
        )}

        <div className="dash-card overflow-hidden flex flex-col" data-tour="org-hospitals-table" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('orgHospitals.headerTitle')}
            stats={[{ label: 'Facilities', value: hospitals.length, color: LIST_STAT_COLORS.muted }]}
            search={{ value: globalSearch, onChange: setGlobalSearch, placeholder: 'Search facilities…' }}
            actions={addButton}
          />
          <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <table className="w-full" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th className="text-start px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.colName')}</th>
                  <th className="text-start px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.fieldState')}</th>
                  <th className="text-start px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.colType')}</th>
                  <th className="text-start px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.colBeds')}</th>
                  <th className="text-start px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.statPatients')}</th>
                  <th className="text-start px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('orgHospitals.colTodayVisits')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredHospitals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center">
                      {/* An empty registry is the FIRST screen of tenant setup,
                          not an error — so it says what to do next rather than
                          reporting "No hospitals found." and stopping. */}
                      <Building2 className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
                      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                        {hospitals.length === 0 ? t('orgHospitals.emptyTitle') : t('orgHospitals.noHospitals')}
                      </p>
                      {hospitals.length === 0 && (
                        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{t('orgHospitals.emptyBody')}</p>
                      )}
                      {hospitals.length === 0 && mayCreate && (
                        <button
                          onClick={() => { setError(''); setShowCreateModal(true); }}
                          className="btn btn-primary btn-sm"
                          data-action="add-first-facility"
                        >
                          <Plus className="w-4 h-4" /> {t('orgHospitals.addFirstFacility')}
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredHospitals.map(hospital => (
                    <tr key={hospital._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'transparent' }}>
                            <Building2 className="w-4 h-4" style={{ color: facilityColor(hospital.facilityType) }} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{hospital.name}</p>
                            <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                              <MapPin className="w-3 h-3" />
                              {hospital.town || '-'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {hospital.state}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: `${facilityColor(hospital.facilityType)}15`,
                            color: facilityColor(hospital.facilityType),
                          }}
                        >
                          {facilityLabel(hospital.facilityType)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {hospital.totalBeds || 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {hospital.patientCount || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {hospital.todayVisits || 0}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreateModal && mayCreate && (
        <CreateFacilityModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
          orgId={currentUser?.orgId}
          organizations={needsOrgPicker ? organizations : undefined}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
          brandColor={brandColor}
        />
      )}
    </div>
  );
}
