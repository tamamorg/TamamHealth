'use client';

/**
 * The facility registry — the canonical place a facility is created — on
 * the shared admin console kit (sadb-*). Restyled from the hand-rolled
 * table 2026-08-21, which also retired `facilityColor()` and its two bare
 * hexes (#2191D0, #6B7F96) in favour of tonal chips: hospital tiers read
 * blue, primary-care tiers neutral. Banners became toasts to match the
 * rest of the console.
 *
 * Two long-standing gaps stay fixed here:
 *  • The create form lives in `CreateFacilityModal` and is opened from the
 *    network directory (`/hospitals`), the global Add menu, and here.
 *  • `loadData` must not return early for accounts with no `orgId` —
 *    that is exactly the platform operator. Facility scoping is
 *    `filterByScope`'s job, not this component's.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useApp } from '@/lib/context';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useToast } from '@/components/Toast';
import { Building2, Plus, MapPin, Users } from '@/components/icons/lucide';
import type { HospitalDoc, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import {
  SadbPage, SadbCard, SadbSearch, SadbGridList, SadbGridRow, SadbChip, type ChipTone,
} from '@/components/admin/sadb-ui';
import CreateFacilityModal from '@/components/admin/CreateFacilityModal';
import { FACILITY_TYPES } from '@/lib/facility-types';
import { canCreateFacilities } from '@/lib/people-nav';

/* Facility · State · Type · Beds · Patients · Today's visits */
const FACILITY_GRID = 'minmax(210px, 1.7fr) minmax(110px, 0.9fr) minmax(130px, 1fr) minmax(70px, 0.6fr) minmax(90px, 0.7fr) minmax(90px, 0.7fr)';

/** Hospital tiers read blue, primary-care tiers neutral — tone, not a
 *  per-type colour ramp (the old map's bare hexes are gone). */
function facilityChipTone(facilityType: string): ChipTone {
  return facilityType === 'phcc' || facilityType === 'phcu' ? 'neutral' : 'blue';
}

export default function OrgHospitalsPage() {
  const { t } = useTranslation();
  const { currentUser, globalSearch, setGlobalSearch } = useApp();
  const { showToast } = useToast();
  const [hospitals, setHospitals] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

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
      showToast(t('orgHospitals.errCreateFailed'), 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // Deep link: `?new=1` (the Add menu, the "no facilities yet" prompt on the
  // user form) opens the create dialog directly.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('new')) setShowCreateModal(true);
  }, []);

  const handleCreated = useCallback(async (hospital: HospitalDoc) => {
    setShowCreateModal(false);
    showToast(t('orgHospitals.successCreated', { name: hospital.name }), 'success');
    await loadData();
  }, [loadData, showToast, t]);

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

  return (
    <SadbPage roles={['org_admin', 'super_admin']}>
      <div data-tour="org-hospitals-table">
        <SadbCard
          title={t('orgHospitals.headerTitle')}
          meta={loading ? undefined : `${filteredHospitals.length} of ${hospitals.length}`}
          action={mayCreate ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-tour="org-hospitals-add"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus className="w-4 h-4" /> {t('orgHospitals.addFacility')}
            </button>
          ) : undefined}
        >
          <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
            <SadbSearch value={globalSearch} onChange={setGlobalSearch} placeholder="Search facilities…" />
          </div>

          <SadbGridList
            template={FACILITY_GRID}
            minWidth={720}
            head={[
              t('hospitals.colName'), t('hospitals.fieldState'), t('hospitals.colType'),
              t('hospitals.colBeds'), t('hospitals.statPatients'), t('orgHospitals.colTodayVisits'),
            ]}
            empty={loading ? 'Loading…' : (
              /* An empty registry is the FIRST screen of tenant setup, not an
                 error — so it says what to do next rather than reporting
                 "No hospitals found." and stopping. */
              hospitals.length === 0 ? (
                <span className="block text-center py-4">
                  <Building2 className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
                  <span className="block text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {t('orgHospitals.emptyTitle')}
                  </span>
                  <span className="block text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    {t('orgHospitals.emptyBody')}
                  </span>
                  {mayCreate && (
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(true)}
                      className="btn btn-primary btn-sm"
                      data-action="add-first-facility"
                    >
                      <Plus className="w-4 h-4" /> {t('orgHospitals.addFirstFacility')}
                    </button>
                  )}
                </span>
              ) : t('orgHospitals.noHospitals')
            )}
          >
            {!loading && filteredHospitals.map(hospital => (
              <SadbGridRow key={hospital._id} template={FACILITY_GRID}>
                <span className="min-w-0">
                  <span className="sadb-tenant-name truncate">{hospital.name}</span>
                  <span className="sadb-tenant-sub flex items-center gap-1">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    {hospital.town || '—'}
                  </span>
                </span>
                <span className="truncate">{hospital.state}</span>
                <span>
                  <SadbChip tone={facilityChipTone(hospital.facilityType)}>
                    {facilityLabel(hospital.facilityType)}
                  </SadbChip>
                </span>
                <span className="sadb-tenant-num">{hospital.totalBeds || 0}</span>
                <span className="sadb-tenant-num flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  {hospital.patientCount || 0}
                </span>
                <span className="sadb-tenant-num">{hospital.todayVisits || 0}</span>
              </SadbGridRow>
            ))}
          </SadbGridList>
        </SadbCard>
      </div>

      {showCreateModal && mayCreate && (
        <CreateFacilityModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
          orgId={currentUser?.orgId}
          organizations={needsOrgPicker ? organizations : undefined}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
        />
      )}
    </SadbPage>
  );
}
