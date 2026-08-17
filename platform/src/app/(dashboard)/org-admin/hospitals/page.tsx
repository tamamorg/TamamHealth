'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useApp } from '@/lib/context';
import {
  Building2, Plus, X, MapPin, ChevronDown, AlertCircle, Users,
} from '@/components/icons/lucide';
import type { HospitalDoc, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';

const FACILITY_TYPES = [
  { value: 'national_referral', label: 'National Referral', labelKey: 'hospitals.typeNationalReferral' },
  { value: 'state_hospital', label: 'State Hospital', labelKey: 'hospitals.typeStateHospital' },
  { value: 'county_hospital', label: 'County Hospital', labelKey: 'hospitals.typeCountyHospital' },
  { value: 'phcc', label: 'Primary Health Care Centre', labelKey: 'hospitals.typePhccFull' },
  { value: 'phcu', label: 'Primary Health Care Unit', labelKey: 'hospitals.typePhcuFull' },
];

export default function OrgHospitalsPage() {
  const { t } = useTranslation();
  const { currentUser, globalSearch, setGlobalSearch } = useApp();
  const [hospitals, setHospitals] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [creating, setCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formState, setFormState] = useState('');
  const [formTown, setFormTown] = useState('');
  const [formType, setFormType] = useState<string>('phcc');
  const [formBeds, setFormBeds] = useState('');

  const brandColor = currentUser?.branding?.primaryColor || 'var(--accent-primary)';

  const loadData = useCallback(async () => {
    if (!currentUser?.orgId) return;
    try {
      const scope: DataScope = { orgId: currentUser.orgId, role: currentUser.role as UserRole };
      const { getAllHospitals } = await import('@/lib/services/hospital-service');
      const h = await getAllHospitals(scope);
      setHospitals(h);
    } catch (err) {
      console.error('Failed to load hospitals:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    setError('');
    if (!formName.trim() || !formState || !formTown.trim() || !formType) {
      setError(t('orgHospitals.errRequiredFields'));
      return;
    }

    setCreating(true);
    try {
      const { createHospital } = await import('@/lib/services/hospital-service');
      await createHospital(
        {
          name: formName.trim(),
          state: formState,
          town: formTown.trim(),
          facilityType: formType as HospitalDoc['facilityType'],
          totalBeds: parseInt(formBeds) || 0,
          icuBeds: 0,
          maternityBeds: 0,
          pediatricBeds: 0,
          doctors: 0,
          clinicalOfficers: 0,
          nurses: 0,
          labTechnicians: 0,
          pharmacists: 0,
          hasElectricity: false,
          electricityHours: 0,
          hasGenerator: false,
          hasSolar: false,
          hasInternet: false,
          internetType: 'none',
          hasAmbulance: false,
          emergency24hr: false,
          services: [],
          lat: 0,
          lng: 0,
          orgId: currentUser?.orgId,
        },
        currentUser?._id,
        currentUser?.username
      );

      setSuccess(t('orgHospitals.successCreated', { name: formName }));
      setShowCreateModal(false);
      setFormName('');
      setFormState('');
      setFormTown('');
      setFormType('phcc');
      setFormBeds('');
      await loadData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || t('orgHospitals.errCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  const filteredHospitals = hospitals.filter(h => {
    if (!globalSearch) return true;
    const q = globalSearch.toLowerCase();
    return (
      h.name.toLowerCase().includes(q) ||
      h.state.toLowerCase().includes(q) ||
      (h.town || '').toLowerCase().includes(q) ||
      h.facilityType.toLowerCase().includes(q)
    );
  });

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
      phcu: '#369FDA',
    };
    return map[ft] || '#6B7280';
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: brandColor }} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Success/Error */}
        {success && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border)' }}>
            {success}
          </div>
        )}
        {error && !showCreateModal && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium" style={{ background: 'rgba(229,46,66,0.1)', color: 'var(--color-danger-text)', border: '1px solid rgba(229,46,66,0.2)' }}>
            {error}
          </div>
        )}

        {/* Hospitals Table */}
        <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('orgHospitals.headerTitle')}
            stats={[{ label: 'Facilities', value: hospitals.length, color: LIST_STAT_COLORS.muted }]}
            search={{ value: globalSearch, onChange: setGlobalSearch, placeholder: 'Search facilities…' }}
            actions={
              <button
                onClick={() => { setError(''); setShowCreateModal(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: brandColor, height: 38, whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <Plus className="w-4 h-4" />
                {t('orgHospitals.addFacility')}
              </button>
            }
          />
          <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.colName')}</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.fieldState')}</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.colType')}</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.colBeds')}</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('hospitals.statPatients')}</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{t('orgHospitals.colTodayVisits')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredHospitals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    {t('orgHospitals.noHospitals')}
                  </td>
                </tr>
              ) : (
                filteredHospitals.map(hospital => (
                  <tr key={hospital._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: 'transparent' }}
                        >
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

      {/* Create Hospital Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="w-full max-w-lg mx-4 rounded-xl shadow-2xl p-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t('orgHospitals.modalTitle')}</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded-lg hover:opacity-80">
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg text-sm flex items-center gap-2" style={{ background: 'rgba(229,46,66,0.1)', color: 'var(--color-danger-text)', border: '1px solid rgba(229,46,66,0.2)' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgHospitals.labelFacilityName')}</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder={t('orgHospitals.placeholderFacilityName')}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* State */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgHospitals.labelState')}</label>
                <div className="relative">
                  <Select
                    value={formState}
                    onChange={e => setFormState(e.target.value)}
                    className="w-full appearance-none px-3 py-2 pr-8 rounded-lg text-sm"
                    style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                  >
                    <option value="">{t('orgHospitals.selectState')}</option>
                    {SOUTH_SUDAN_STATES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>

              {/* Location / Town */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgHospitals.labelTown')}</label>
                <input
                  type="text"
                  value={formTown}
                  onChange={e => setFormTown(e.target.value)}
                  placeholder={t('orgHospitals.placeholderTown')}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Facility Type */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgHospitals.labelFacilityType')}</label>
                <div className="relative">
                  <Select
                    value={formType}
                    onChange={e => setFormType(e.target.value)}
                    className="w-full appearance-none px-3 py-2 pr-8 rounded-lg text-sm"
                    style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                  >
                    {FACILITY_TYPES.map(ft => (
                      <option key={ft.value} value={ft.value}>{t(ft.labelKey)}</option>
                    ))}
                  </Select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>

              {/* Total Beds */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('hospitals.colTotalBeds')}</label>
                <input
                  type="number"
                  value={formBeds}
                  onChange={e => setFormBeds(e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
              >
                {t('action.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: brandColor }}
              >
                {creating ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {t('orgHospitals.createFacility')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
