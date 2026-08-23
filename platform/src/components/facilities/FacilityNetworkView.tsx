'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Building2, BedDouble, Users, Stethoscope, WifiOff,
  Zap, ZapOff, Sun, Truck, Signal, Clock, Activity,
  MapPin, HeartPulse, X, Phone, Mail, UserPlus,
  FlaskConical, Download, Eye, Settings, Plus, Edit3, Ban, RotateCcw,
  Syringe, Baby, Pill, ShieldCheck, Microscope, ChevronDown,
} from '@/components/icons/lucide';
import {
  ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useWards } from '@/lib/hooks/useWards';
import { useFacilityCensus } from '@/lib/hooks/useFacilityCensus';
import { censusFor } from '@/lib/services/facility-census';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useApp } from '@/lib/context';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { canCreateFacilities } from '@/lib/people-nav';
import { isFacilityActive } from '@/lib/services/hospital-service';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { FilterSelect } from '@/components/filters';
import EhrListHeader, { EhrListFilters, EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import Modal from '@/components/Modal';
import RowActionsPopup, { rowActionsFromElement, type RowActionsPopupState } from '@/components/RowActionsPopup';
import { CreateUserModal, CredentialHandoffModal, type CreatedCredentials } from '@/modules/identity/client';
import { canCreateUsers } from '@/lib/people-nav';
import FacilityManageTabs, {
  FACILITY_MANAGE_TABS, FACILITY_SETTINGS_WRITE_ROLES, type FacilityTabId,
} from '@/components/facilities/FacilityManageTabs';
import type { DataScope } from '@/lib/services/data-scope';
import type { HospitalDoc, UserRole } from '@/lib/db-types';

// Roles that can work a facility (Staff, Wards, Equipment, Inventory,
// Schedules, Performance, Settings). Those tabs live on this page now — the
// separate /hospitals/[id]/manage screen they used to occupy redirects here —
// so this list decides whether the profile shows them at all. Every service
// call underneath is still scoped, so hiding the tabs is presentation, not
// the barrier.
const MANAGE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hrio',
];
import {
  getPerformanceColor,
  METRIC_LABELS, type PerformanceMetricKey,
} from '@/lib/performance-colors';
import { states, statesAndCounties } from '@/lib/data/south-sudan-reference';
import { todayIso } from '@/lib/date-utils';

// ───────────────────────────── helpers ─────────────────────────────
const TYPE_LABEL_KEYS: Record<string, string> = {
  national_referral: 'hospitals.typeNationalReferral',
  state_hospital: 'hospitals.typeStateHospital',
  county_hospital: 'hospitals.typeCountyHospital',
  phcc: 'hospitals.typePhcc',
  phcu: 'hospitals.typePhcu',
};

const TYPE_SHORT: Record<string, string> = {
  national_referral: 'NR',
  state_hospital: 'SH',
  county_hospital: 'CH',
  phcc: 'PHCC',
  phcu: 'PHCU',
};

const OWNERSHIP_LABEL_KEYS: Record<string, string> = {
  public: 'hospitals.ownershipPublic',
  ngo: 'hospitals.ownershipNgo',
  private: 'hospitals.ownershipPrivate',
  faith_based: 'hospitals.ownershipFaithBased',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  functional: 'hospitals.statusFunctional',
  partially_functional: 'hospitals.statusPartial',
  non_functional: 'hospitals.statusNonFunctional',
  closed: 'hospitals.statusClosed',
};

const STATUS_COLORS: Record<string, string> = {
  functional: 'var(--accent-primary)',
  partially_functional: 'var(--color-warning)',
  non_functional: 'var(--color-danger)',
  closed: 'var(--text-muted)',
};

const METRIC_KEYS: PerformanceMetricKey[] = [
  'reportingCompleteness', 'serviceReadinessScore', 'tracerMedicineAvailability',
  'staffingScore', 'ancCoverage', 'immunizationCoverage', 'qualityScore',
  'stockOutDays', 'opdVisitsPerMonth',
];

const PERCENTAGE_METRICS: PerformanceMetricKey[] = [
  'reportingCompleteness', 'serviceReadinessScore', 'tracerMedicineAvailability',
  'staffingScore', 'ancCoverage', 'immunizationCoverage', 'qualityScore',
];

const SERVICE_FLAG_ICONS: Record<string, { icon: React.ElementType; labelKey: string }> = {
  epi: { icon: Syringe, labelKey: 'hospitals.serviceEpi' },
  anc: { icon: Baby, labelKey: 'hospitals.serviceAnc' },
  delivery: { icon: HeartPulse, labelKey: 'hospitals.serviceDelivery' },
  hiv: { icon: ShieldCheck, labelKey: 'hospitals.serviceHiv' },
  tb: { icon: Activity, labelKey: 'hospitals.serviceTb' },
  emergencySurgery: { icon: FlaskConical, labelKey: 'hospitals.serviceSurgery' },
  laboratory: { icon: Microscope, labelKey: 'hospitals.serviceLab' },
  pharmacy: { icon: Pill, labelKey: 'hospitals.servicePharmacy' },
};

function formatMetricValue(key: PerformanceMetricKey, value: number): string {
  if (key === 'opdVisitsPerMonth') return value.toLocaleString();
  if (key === 'stockOutDays') return `${value}d`;
  return `${Math.round(value)}%`;
}

function normalizeMetricForColor(key: PerformanceMetricKey, value: number): number {
  if (key === 'stockOutDays') return Math.max(0, 100 - value * 3.3);
  if (key === 'opdVisitsPerMonth') return Math.min(100, value / 60);
  return value;
}

// ───────────────────────────── page ─────────────────────────────
function HospitalsPageInner() {
  const { t } = useTranslation();
  const { hospitals, loading, reload: reloadHospitals } = useHospitals();
  const { globalSearch, currentUser } = useApp();
  const canManage = !!currentUser && MANAGE_ROLES.includes(currentUser.role);
  // Registering a facility is an organisation-level act, so it is narrower
  // than `canManage` (which also covers running one). This is the action that
  // used to exist only on a page with no nav row.
  const canCreate = canCreateFacilities(currentUser?.role ?? '');
  const [showCreateFacility, setShowCreateFacility] = useState(false);
  // The facility being edited. Until now nothing could change a facility's
  // beds, type, location, staffing or infrastructure after registration — they
  // were settable once, in a create form, and wrong forever if mistyped.
  const [editingFacility, setEditingFacility] = useState<HospitalDoc | null>(null);
  const [retireTarget, setRetireTarget] = useState<HospitalDoc | null>(null);
  const [createdFacility, setCreatedFacility] = useState<string | null>(null);
  const { showToast } = useToast();
  // A platform operator carries no orgId, so the dialog asks which tenant owns
  // the new facility; a tenant admin's own org is used and never asked for.
  const { organizations } = useOrganizations();
  const searchParams = useSearchParams();
  const stateParam = searchParams.get('state');
  const countyParam = searchParams.get('county');
  const [selectedHospital, setSelectedHospital] = useState<HospitalDoc | null>(null);
  // Which tab the profile should open on when it was reached from the list's
  // gear menu rather than from a row click or a ?tab= link.
  const [pendingTab, setPendingTab] = useState<ProfileTabId | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState(() => stateParam || 'all');

  // Auto-select hospital from URL query param. Re-run whenever the param
  // changes — guarding on `!selectedHospital` previously froze the selection
  // after the first auto-select, so navigating back to the page with a new
  // ?facility= silently kept the old card open.
  const facilityIdParam = searchParams.get('facility');
  // `?tab=` opens the profile on one of its management tabs. The old
  // /hospitals/[hospitalId]/manage route redirects here carrying it.
  const profileTabParam = parseProfileTab(searchParams.get('tab'));
  useEffect(() => {
    if (!facilityIdParam || hospitals.length === 0) return;
    const found = hospitals.find(h => h._id === facilityIdParam);
    if (found) setSelectedHospital(found);
  }, [facilityIdParam, hospitals]);

  // `?new=1` — the global Add menu's "Add facility" entry, and the prompt the
  // user form shows when a facility-bound role has no facility to be assigned
  // to, both land here with the dialog already open.
  const newParam = searchParams.get('new');
  useEffect(() => {
    if (newParam && canCreate) setShowCreateFacility(true);
  }, [newParam, canCreate]);
  const [filterCounty, setFilterCounty] = useState(() => countyParam || 'all');
  const [filterType, setFilterType] = useState('all');
  const [filterOwnership, setFilterOwnership] = useState('all');
  const [filterService, setFilterService] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [colorMetric, setColorMetric] = useState<PerformanceMetricKey>('serviceReadinessScore');

  // Counties for selected state
  const availableCounties = useMemo(() => {
    if (filterState === 'all') return [];
    return statesAndCounties[filterState] || [];
  }, [filterState]);

  const changeFilterState = (nextState: string) => {
    setFilterState(nextState);
    setFilterCounty('all');
  };

  // ── Filter ──
  const filteredHospitals = useMemo(() => {
    return hospitals.filter(h => {
      const combined = [search, globalSearch].filter(Boolean).join(' ').toLowerCase().trim();
      if (combined) {
        const terms = combined.split(/\s+/);
        const haystack = [h.name || '', h.state || '', h.town || '', h.facilityType || '', ...(h.services || [])].join(' ').toLowerCase();
        if (!terms.every(term => haystack.includes(term))) return false;
      }
      if (filterState !== 'all' && h.state !== filterState) return false;
      if (filterCounty !== 'all' && h.county !== filterCounty) return false;
      if (filterType !== 'all' && h.facilityType !== filterType) return false;
      if (filterOwnership !== 'all' && h.ownership !== filterOwnership) return false;
      if (filterStatus !== 'all' && h.operationalStatus !== filterStatus) return false;
      if (filterService !== 'all' && h.serviceFlags) {
        const flags = h.serviceFlags as Record<string, boolean>;
        if (!flags[filterService]) return false;
      }
      return true;
    });
  }, [hospitals, search, globalSearch, filterState, filterCounty, filterType, filterOwnership, filterStatus, filterService]);

  // ── KPIs ──
  // Performance averages run over the facilities that HAVE performance data
  // only — `performance` is written by nothing in the app (it exists only on
  // seeded demo records), so averaging `|| 0` across every facility reported
  // "Avg reporting 0%" as a measured fact on real deployments. With no
  // measured facility at all the figures read '—', never a false zero.
  const kpis = useMemo(() => {
    const f = filteredHospitals;
    const functional = f.filter(h => h.operationalStatus === 'functional').length;
    const withPerf = f.filter(h => h.performance);
    const avgReporting = withPerf.length
      ? Math.round(withPerf.reduce((s, h) => s + (h.performance?.reportingCompleteness || 0), 0) / withPerf.length)
      : null;
    const avgReadiness = withPerf.length
      ? Math.round(withPerf.reduce((s, h) => s + (h.performance?.serviceReadinessScore || 0), 0) / withPerf.length)
      : null;
    const coverageGaps = withPerf.filter(h => (h.performance?.immunizationCoverage || 0) < 50).length;
    const totalStaff = f.reduce((s, h) => s + (h.doctors || 0) + (h.nurses || 0) + (h.clinicalOfficers || 0), 0);
    const totalBeds = f.reduce((s, h) => s + (h.totalBeds || 0), 0);
    return {
      total: f.length,
      pctFunctional: f.length ? Math.round((functional / f.length) * 100) : 0,
      avgReporting,
      avgReadiness,
      coverageGaps,
      hasPerformanceData: withPerf.length > 0,
      staffPerBed: totalBeds ? (totalStaff / totalBeds).toFixed(1) : '—',
    };
  }, [filteredHospitals]);

  // Badge count for the Filters pill — colorMetric is a display option, not a
  // row filter, so it's excluded.
  const activeFilterCount = [filterState, filterCounty, filterType, filterOwnership, filterService, filterStatus].filter(v => v !== 'all').length;
  const clearHospitalFilters = () => {
    setFilterState('all'); setFilterCounty('all'); setFilterType('all');
    setFilterOwnership('all'); setFilterService('all'); setFilterStatus('all');
  };


  // ── CSV export ──
  const handleExport = useCallback(() => {
    const headers = ['Name', 'Type', 'State', 'County', 'Town', 'Ownership', 'Status', 'Beds',
      'Doctors', 'Nurses', 'Reporting%', 'Readiness%', 'Medicines%', 'Staffing%',
      'ANC Coverage%', 'EPI Coverage%', 'Quality', 'OPD/Month', 'Stock-out Days'];
    const rows = filteredHospitals.map(h => [
      h.name, TYPE_LABEL_KEYS[h.facilityType] ? t(TYPE_LABEL_KEYS[h.facilityType]) : h.facilityType, h.state, h.county, h.town,
      h.ownership, h.operationalStatus, h.totalBeds,
      h.doctors, h.nurses,
      h.performance?.reportingCompleteness, h.performance?.serviceReadinessScore,
      h.performance?.tracerMedicineAvailability, h.performance?.staffingScore,
      h.performance?.ancCoverage, h.performance?.immunizationCoverage,
      h.performance?.qualityScore, h.performance?.opdVisitsPerMonth, h.performance?.stockOutDays,
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facility-performance-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredHospitals]);

  if (loading) {
    return (
      <>
        <main className="page-container flex items-center justify-center page-enter">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('hospitals.loadingFacilities')}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* ── Facility Table / Profile ── */}
        <div className="card-elevated flex flex-col" style={{ overflow: 'hidden', flex: 1, minHeight: 0 }}>
          {selectedHospital ? (
            <FacilityProfile
              hospital={selectedHospital}
              onClose={() => { setSelectedHospital(null); setPendingTab(undefined); }}
              canManage={canManage}
              canCreate={canCreate}
              onEdit={() => setEditingFacility(selectedHospital)}
              onRetire={() => setRetireTarget(selectedHospital)}
              initialTab={pendingTab ?? profileTabParam}
              onHospitalSaved={(saved) => { setSelectedHospital(saved); reloadHospitals(); }}
            />
          ) : (
            <>
              {/* No greeting and no title: this is a section of the
                  Organizations page now, which already names itself and the
                  signed-in user above. The header stays for what it uniquely
                  carries — the network's stat row, the search and the
                  filter/export/add actions. */}
              <EhrListHeader
                greeting={false}
                title=""
                stats={[
                  { label: t('hospitals.kpiFacilities'), value: kpis.total, color: LIST_STAT_COLORS.muted },
                  { label: t('hospitals.kpiFunctional'), value: `${kpis.pctFunctional}%`, color: getPerformanceColor(kpis.pctFunctional) },
                  { label: t('hospitals.kpiReporting'), value: kpis.avgReporting === null ? '—' : `${kpis.avgReporting}%`, color: kpis.avgReporting === null ? LIST_STAT_COLORS.muted : getPerformanceColor(kpis.avgReporting) },
                  { label: t('hospitals.kpiReadiness'), value: kpis.avgReadiness === null ? '—' : `${kpis.avgReadiness}%`, color: kpis.avgReadiness === null ? LIST_STAT_COLORS.muted : getPerformanceColor(kpis.avgReadiness) },
                  { label: t('hospitals.kpiGaps'), value: kpis.hasPerformanceData ? kpis.coverageGaps : '—', color: !kpis.hasPerformanceData ? LIST_STAT_COLORS.muted : kpis.coverageGaps > 5 ? 'var(--color-danger)' : 'var(--color-warning)' },
                  { label: t('hospitals.kpiStaffPerBed'), value: kpis.staffPerBed, color: LIST_STAT_COLORS.muted },
                  // The Online/Offline chips are gone: they counted
                  // HospitalDoc.syncStatus, a field frozen at creation that no
                  // sync code ever updates — the split measured how records
                  // were created, not connectivity.
                ]}
                search={{ value: search, onChange: setSearch, placeholder: t('hospitals.searchPlaceholder'), ariaLabel: t('hospitals.searchPlaceholder') }}
                actions={
                  <>
                    <EhrListFilters
                      activeCount={activeFilterCount}
                      onClear={clearHospitalFilters}
                      label={t('hospitals.filters')}
                      panelWidth={560}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <FilterDropdown label={t('hospitals.filterState')} value={filterState} onChange={changeFilterState} options={[{ value: 'all', label: t('hospitals.allStates') }, ...states.map(s => ({ value: s, label: s }))]} />
                        {availableCounties.length > 0 && (
                          <FilterDropdown label={t('hospitals.filterCounty')} value={filterCounty} onChange={setFilterCounty} options={[{ value: 'all', label: t('hospitals.allCounties') }, ...availableCounties.map(c => ({ value: c, label: c }))]} />
                        )}
                        <FilterDropdown label={t('hospitals.filterType')} value={filterType} onChange={setFilterType} options={[{ value: 'all', label: t('hospitals.allTypes') }, ...Object.entries(TYPE_LABEL_KEYS).map(([v, l]) => ({ value: v, label: t(l) }))]} />
                        <FilterDropdown label={t('hospitals.filterOwnership')} value={filterOwnership} onChange={setFilterOwnership} options={[{ value: 'all', label: t('hospitals.allOwnership') }, ...Object.entries(OWNERSHIP_LABEL_KEYS).map(([v, l]) => ({ value: v, label: t(l) }))]} />
                        <FilterDropdown label={t('hospitals.filterService')} value={filterService} onChange={setFilterService} options={[{ value: 'all', label: t('hospitals.allServices') }, ...Object.entries(SERVICE_FLAG_ICONS).map(([k, v]) => ({ value: k, label: t(v.labelKey) }))]} />
                        <FilterDropdown label={t('hospitals.filterStatus')} value={filterStatus} onChange={setFilterStatus} options={[{ value: 'all', label: t('hospitals.allStatus') }, ...Object.entries(STATUS_LABEL_KEYS).map(([v, l]) => ({ value: v, label: t(l) }))]} />
                        <FilterDropdown label={t('hospitals.colorBy')} value={colorMetric} onChange={v => setColorMetric(v as PerformanceMetricKey)} options={METRIC_KEYS.map(k => ({ value: k, label: METRIC_LABELS[k] }))} />
                      </div>
                    </EhrListFilters>
                    <EhrListHeaderButton onClick={handleExport} ariaLabel={t('action.export')}>
                      <Download className="w-4 h-4" />
                    </EhrListHeaderButton>
                    {canCreate && (
                      <EhrListHeaderButton primary onClick={() => setShowCreateFacility(true)} ariaLabel={t('orgHospitals.addFacility')}>
                        {/* `color` (not a class) is required on the primary
                            variant: globals.css repaints any lucide glyph with
                            no inline colour to --icon-color, which is the same
                            brand blue as this button's fill — the plus was
                            invisible. The prop writes a literal stroke, which
                            beats the rule. Same as /inquiries and /hr/*. */}
                        <Plus size={16} color="#fff" />
                      </EhrListHeaderButton>
                    )}
                  </>
                }
              />
              <FacilityList
                hospitals={filteredHospitals}
                colorMetric={colorMetric}
                // A plain row click opens the facility on Overview, so the tab
                // a gear picked earlier must not follow the next facility in.
                onSelect={h => { setPendingTab(undefined); setSelectedHospital(h); }}
                canManage={canManage}
                onOpenTab={(h, tabId) => { setPendingTab(tabId); setSelectedHospital(h); }}
              />
            </>
          )}
        </div>
      </main>

      {(showCreateFacility || editingFacility) && canCreate && (
        <FacilityFormModal
          facility={editingFacility ?? undefined}
          onClose={() => { setShowCreateFacility(false); setEditingFacility(null); }}
          onSaved={async hospital => {
            const wasEdit = !!editingFacility;
            setShowCreateFacility(false);
            setEditingFacility(null);
            await reloadHospitals();
            if (wasEdit) {
              // Keep the profile open on the record just edited, showing the
              // saved values rather than the stale ones behind the dialog.
              setSelectedHospital(hospital);
              showToast(t('orgHospitals.updatedToast', { name: hospital.name }), 'success');
            } else {
              setCreatedFacility(hospital.name);
              setTimeout(() => setCreatedFacility(null), 4000);
            }
          }}
          orgId={currentUser?.orgId}
          organizations={currentUser?.orgId ? undefined : organizations}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
          brandColor={currentUser?.branding?.primaryColor || 'var(--accent-primary)'}
        />
      )}
      {/* Retiring is a soft flag, never a delete: admissions, bills and staff
          records all carry this facility's id, and removing the document would
          orphan every one of them. */}
      {retireTarget && canCreate && (
        <ConfirmRetireFacility
          hospital={retireTarget}
          onClose={() => setRetireTarget(null)}
          onDone={async (updated, retired) => {
            setRetireTarget(null);
            await reloadHospitals();
            setSelectedHospital(updated);
            showToast(
              t(retired ? 'orgHospitals.retiredToast' : 'orgHospitals.restoredToast', { name: updated.name }),
              'success',
            );
          }}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
        />
      )}
      {createdFacility && (
        <div
          role="status"
          className="fixed bottom-6 start-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-sm font-semibold shadow-lg"
          style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border)' }}
        >
          {t('orgHospitals.successCreated', { name: createdFacility })}
        </div>
      )}
    </>
  );
}

/**
 * Retire / restore confirmation.
 *
 * Retiring reads as a delete to the person clicking it, so the copy says what
 * actually happens: the records stay, the facility stops appearing when new
 * work is assigned, and the plan's facility slot comes back.
 */
function ConfirmRetireFacility({ hospital, onClose, onDone, actor }: {
  hospital: HospitalDoc;
  onClose: () => void;
  onDone: (updated: HospitalDoc, retired: boolean) => void;
  actor?: { _id?: string; username?: string };
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const retiring = isFacilityActive(hospital);

  const run = async () => {
    setSaving(true);
    try {
      const { setFacilityActive } = await import('@/lib/services/hospital-service');
      const updated = await setFacilityActive(hospital._id, !retiring, actor?._id, actor?.username);
      if (updated) onDone(updated, retiring);
      else onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={420} labelledBy="retire-facility-title">
      <div className={`sadb-modal${retiring ? ' sadb-modal--danger' : ''}`}>
        <div className="sadb-modal-copy">
          <h2 id="retire-facility-title" className="sadb-modal-title">
            {retiring ? t('orgHospitals.retire') : t('orgHospitals.restore')}
          </h2>
          <p className="sadb-modal-sub">
            {retiring ? t('orgHospitals.retireConfirm', { name: hospital.name }) : hospital.name}
          </p>
        </div>
        <div className="sadb-modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
            {t('action.cancel')}
          </button>
          <button
            type="button" className="btn btn-primary btn-sm" onClick={run} disabled={saving}
            data-action="confirm-retire-facility"
          >
            {retiring ? t('orgHospitals.retire') : t('orgHospitals.restore')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════
//  Filter Dropdown
// ═══════════════════════════════════════════
function FilterDropdown({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <FilterSelect label={label} value={value} onChange={onChange} options={options} size="sm" />
  );
}

// ═══════════════════════════════════════════
//  Facility List (no selection)
// ═══════════════════════════════════════════
/**
 * Clip rather than wrap. The columns are equal width, so the two free-text
 * cells (facility name, location) are the ones that can outgrow their share —
 * and a wrapped cell makes that single row taller, which is exactly the uneven
 * rhythm the equal widths exist to prevent. Both carry a `title` so the full
 * value is still readable.
 */
const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function FacilityList({ hospitals, colorMetric, onSelect, canManage, onOpenTab }: {
  hospitals: HospitalDoc[];
  colorMetric: PerformanceMetricKey;
  onSelect: (h: HospitalDoc) => void;
  /** Whether this role has the facility's management tabs at all. */
  canManage: boolean;
  /** Open a facility straight on one of its tabs. */
  onOpenTab: (hospital: HospitalDoc, tab: ProfileTabId) => void;
}) {
  const { t } = useTranslation();
  // One popup for the whole list — the clicked row supplies its actions and
  // position, so a hundred facilities cost one portal, not a hundred.
  const [rowMenu, setRowMenu] = useState<RowActionsPopupState | null>(null);
  if (hospitals.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Building2 style={{ width: 32, height: 32, color: 'var(--text-muted)', opacity: 0.3, margin: '0 auto 12px' }} />
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('hospitals.noFacilitiesMatch')}</p>
      </div>
    );
  }

  return (
    <div className="ehr-list-scroll">
      {/* The floor is set by the widest cell, not by the narrowest screen: with
          equal columns, `minWidth` is what decides whether a laptop scrolls the
          table or squeezes every name into an ellipsis. At 1100 the columns
          fell to ~138px and 18 of 41 facility names truncated; 1560 keeps a
          column at ~185px — the same width it has on a large display — and lets
          `.ehr-list-scroll` scroll instead. */}
      <table className="data-table" style={{ minWidth: 1560, tableLayout: 'fixed' }}>
        {/* One even rhythm across the row: the eight data columns are the same
            width, and only the row number is narrower — a counter never needs
            more than its digits.

            The colgroup is the ONLY place widths are declared. `table-layout:
            fixed` takes them from the first row it finds, so the per-<th>
            widths that used to sit below disagreed with these and were simply
            ignored — two sets of numbers, one of them fiction. Widths must
            also stay exhaustive: a short colgroup leaves the last column to
            absorb the remainder, which is what left Sync stranded mid-row
            after the Manage column was removed. */}
        <colgroup>
          <col style={{ width: '4%' }} />
          {Array.from({ length: 8 }, (_, i) => <col key={i} style={{ width: canManage ? '11.5%' : '12%' }} />)}
          {/* Actions gutter — only when the role has tabs to jump to. Widths
              must stay exhaustive (see above), so the data columns give up
              half a point each to pay for it. */}
          {canManage && <col style={{ width: '4%' }} />}
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'center' }}>#</th>
            <th>{t('hospitals.colFacility')}</th>
            <th>{t('hospitals.colType')}</th>
            <th>{t('hospitals.colLocation')}</th>
            <th>{t('hospitals.colStatus')}</th>
            <th>{t('hospitals.colBeds')}</th>
            <th>{t('hospitals.colStaff')}</th>
            <th>{METRIC_LABELS[colorMetric]}</th>
            {/* The Sync column was removed 2026-08: it displayed
                HospitalDoc.syncStatus, which is frozen at creation — every
                app-created facility read "offline" forever. Bring it back only
                with a real per-facility liveness source (sync events). */}
            {canManage && <th aria-label={t('hospitals.manage')} />}
          </tr>
        </thead>
        <tbody>
          {hospitals.map((h, i) => {
            const metricVal = h.performance ? (h.performance[colorMetric as keyof typeof h.performance] as number) : 0;
            const normVal = normalizeMetricForColor(colorMetric, metricVal);
            const staff = (h.doctors || 0) + (h.nurses || 0) + (h.clinicalOfficers || 0);
            return (
              <tr key={h._id} onClick={() => onSelect(h)} style={{ cursor: 'pointer' }}>
                <td style={{ textAlign: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 7, background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                </td>
                <td style={ELLIPSIS} title={h.name}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{h.name}</span>
                </td>
                <td>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {TYPE_SHORT[h.facilityType] || h.facilityType}
                  </span>
                </td>
                <td style={{ ...ELLIPSIS, fontSize: 12, color: 'var(--text-secondary)' }} title={`${h.town}, ${h.state}`}>
                  {h.town}, {h.state}
                </td>
                <td>
                  {h.operationalStatus && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLORS[h.operationalStatus] }}>
                      {t(STATUS_LABEL_KEYS[h.operationalStatus])}
                    </span>
                  )}
                </td>
                <td className="stat-value" style={{ fontWeight: 600 }}>{h.totalBeds}</td>
                <td className="stat-value" style={{ fontWeight: 600 }}>{staff}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      flex: 1, height: 6, borderRadius: 3, background: `color-mix(in srgb, ${getPerformanceColor(normVal)} 16%, transparent)`, maxWidth: 72,
                    }}>
                      <div style={{
                        width: `${Math.min(100, PERCENTAGE_METRICS.includes(colorMetric) ? metricVal : normVal)}%`,
                        height: '100%', borderRadius: 3,
                        background: getPerformanceColor(normVal),
                      }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: getPerformanceColor(normVal), minWidth: 36 }}>
                      {formatMetricValue(colorMetric, metricVal)}
                    </span>
                  </div>
                </td>
                {canManage && (
                  /* The gear is a shortcut, not the only way in: the row still
                     opens the facility on Overview. This is for the times you
                     already know you want its roster or its stock, and would
                     otherwise open the profile just to click a tab. */
                  <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={t('hospitals.manageTitle', { name: h.name })}
                      aria-haspopup="menu"
                      data-action="facility-tab-menu"
                      data-tour="facility-row-tabs"
                      onClick={e => {
                        e.stopPropagation();
                        setRowMenu(rowActionsFromElement(e.currentTarget, PROFILE_TABS.map(tabItem => ({
                          key: tabItem.id,
                          label: t(tabItem.labelKey),
                          onClick: () => onOpenTab(h, tabItem.id),
                        }))));
                      }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 26, height: 26, borderRadius: 7, cursor: 'pointer',
                        background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
                      }}
                    >
                      <Settings style={{ width: 13, height: 13, color: 'var(--text-muted)' }} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <RowActionsPopup state={rowMenu} onClose={() => setRowMenu(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════
//  Facility Profile Panel (with selection)
// ═══════════════════════════════════════════

/** The profile's own content is the first tab; the rest are the facility
 *  management tabs that used to be a page of their own. */
type ProfileTabId = 'overview' | FacilityTabId;

const PROFILE_TABS: { id: ProfileTabId; labelKey: string; icon: React.ElementType }[] = [
  { id: 'overview', labelKey: 'hospitals.tabOverview', icon: Eye },
  ...FACILITY_MANAGE_TABS,
];

/** `?tab=` is only honoured for a tab that exists. */
function parseProfileTab(value: string | null): ProfileTabId | undefined {
  return PROFILE_TABS.some(item => item.id === value) ? value as ProfileTabId : undefined;
}
/**
 * One facility, in full. Exported so `/admin/facilities/[id]` can host it as a
 * page — the Facilities tab used to render it inline over its own list, which
 * is the pattern the organizations registry dropped when its rows started
 * opening `/admin/organizations/[id]`.
 */
export function FacilityProfile({ hospital, onClose, canManage, canCreate, onEdit, onRetire, initialTab, onHospitalSaved }: {
  hospital: HospitalDoc;
  onClose: () => void;
  canManage: boolean;
  /** Registering, editing and retiring are all organisation-level acts. */
  canCreate: boolean;
  onEdit: () => void;
  onRetire: () => void;
  /** Tab to open on — `?tab=` on the URL, including the redirect the old
   *  /hospitals/[id]/manage route sends here. */
  initialTab?: ProfileTabId;
  /** The Settings tab writes the facility; the list above it must not keep
   *  rendering the stale record. */
  onHospitalSaved: (hospital: HospitalDoc) => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useApp();
  // Real counts for the profile KPIs — the stored patientCount/todayVisits
  // registry fields are write-once-zero (2026-08 hardcoded-data sweep), and
  // the ward docs are the only true occupancy signal.
  const { census: facilityCensus } = useFacilityCensus();
  const { wards } = useWards();
  const [tab, setTab] = useState<ProfileTabId>(initialTab ?? 'overview');
  // A late-arriving ?tab= (the manage-route redirect lands before the
  // facility list has loaded) still opens the tab it asked for.
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  // Scope every service call the tabs make to this facility, in this org, as
  // this role — the same object the standalone manage page built from the URL.
  const scope: DataScope | undefined = useMemo(() => {
    if (!currentUser) return undefined;
    return { role: currentUser.role, orgId: currentUser.orgId, hospitalId: hospital._id };
  }, [currentUser, hospital._id]);
  const canWriteSettings = !!currentUser && FACILITY_SETTINGS_WRITE_ROLES.includes(currentUser.role);

  // The eight sections were a tab strip under this header. As a menu they sit
  // beside the facility's own actions, so the row reads as one set of things
  // you can do with this facility, and the panel opens on content rather than
  // on a row of navigation.
  const [sectionOpen, setSectionOpen] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sectionOpen) return;
    const onDown = (event: MouseEvent) => {
      if (sectionRef.current && !sectionRef.current.contains(event.target as Node)) setSectionOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSectionOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [sectionOpen]);
  const activeSection = PROFILE_TABS.find(item => item.id === tab) ?? PROFILE_TABS[0];

  /**
   * How many people can actually sign in here.
   *
   * The role counts on the facility record are an ESTABLISHMENT — the posts
   * the facility is staffed for, reported to the ministry. They are not user
   * accounts, and nothing ever created one from them. Read side by side, the
   * Overview said "Staff 6" while the Staff tab said "No staff assigned to
   * this facility yet", and both were telling the truth about different
   * things. This is the same query that tab runs, so the two now agree.
   */
  const [staffAccounts, setStaffAccounts] = useState<number | null>(null);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      try {
        const { getAllUsers } = await import('@/modules/identity/services/user-service');
        const all = await getAllUsers(scope);
        if (!cancelled) setStaffAccounts(all.filter(u => u.hospitalId === hospital._id).length);
      } catch {
        // A roster that cannot be read is not a roster of zero — leave it
        // unknown rather than reporting an absence the query never proved.
        if (!cancelled) setStaffAccounts(null);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, hospital._id]);

  const totalStaff = (hospital.doctors || 0) + (hospital.clinicalOfficers || 0) + (hospital.nurses || 0) + (hospital.labTechnicians || 0) + (hospital.pharmacists || 0);
  /* Adding staff belongs beside Edit facility, not only inside the Staff
     section: hiring into a facility is something you decide while looking at
     the facility, and it was previously two clicks and a section change away.
     Reading the roster and writing to it are different grants — the
     superintendent and HRIO who reach this panel are not /api/users'
     WRITE_ROLES — so the button is gated on canCreateUsers, not on canManage. */
  const canAddUser = canCreateUsers(currentUser?.role || '');
  const [showAddUser, setShowAddUser] = useState(false);
  const [userHandoff, setUserHandoff] = useState<CreatedCredentials | null>(null);
  const [staffRefreshToken, setStaffRefreshToken] = useState(0);
  const contact = hospital as unknown as { phone?: string; email?: string };
  // Real occupancy from this facility's ward documents (the same census the
  // Wards board draws from) — null when the facility has no ward docs yet.
  // The old "estimate" summed ICU+maternity+paediatric CAPACITY and divided
  // by total capacity: a constant that never moved with admissions.
  const facilityWards = wards.filter(w => w.facilityId === hospital._id);
  const wardBedTotal = facilityWards.reduce((s, w) => s + (w.totalBeds || 0), 0);
  const wardBedsOccupied = facilityWards.reduce((s, w) => s + (w.occupiedBeds || 0), 0);
  const occupancyPct = wardBedTotal > 0 ? Math.round((wardBedsOccupied / wardBedTotal) * 100) : null;

  return (
    <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{hospital.name}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
            <span className="badge" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', fontSize: 11 }}>
              {TYPE_LABEL_KEYS[hospital.facilityType] ? t(TYPE_LABEL_KEYS[hospital.facilityType]) : hospital.facilityType}
            </span>
            {hospital.ownership && <span style={{ color: 'var(--text-muted)' }}>{t(OWNERSHIP_LABEL_KEYS[hospital.ownership])}</span>}
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
              <MapPin style={{ width: 12, height: 12 }} />{hospital.town}, {hospital.state}
            </span>
            {hospital.operationalStatus && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, color: STATUS_COLORS[hospital.operationalStatus] }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[hospital.operationalStatus] }} />
                {t(STATUS_LABEL_KEYS[hospital.operationalStatus])}
              </span>
            )}
            {/* How to reach the facility. Only the manage screen carried these,
                and that screen no longer exists — the address is already on
                this line, so this is the phone and inbox behind it. */}
            {contact.phone && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
                <Phone style={{ width: 12, height: 12 }} />{contact.phone}
              </span>
            )}
            {contact.email && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
                <Mail style={{ width: 12, height: 12 }} />{contact.email}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {canManage && (
            <div className="fac-secnav" ref={sectionRef}>
              <button
                type="button"
                className="fac-secnav-trigger"
                aria-haspopup="menu"
                aria-expanded={sectionOpen}
                aria-label={t('hospitals.manageTitle', { name: hospital.name })}
                onClick={() => setSectionOpen(open => !open)}
                data-action="facility-section"
              >
                <activeSection.icon />
                <span>{t(activeSection.labelKey)}</span>
                <ChevronDown className="fac-secnav-caret" />
              </button>
              {sectionOpen && (
                <div className="fac-secnav-menu" role="menu">
                  {PROFILE_TABS.map(tabItem => (
                    <button
                      key={tabItem.id}
                      type="button"
                      role="menuitem"
                      className={`fac-secnav-item${tab === tabItem.id ? ' is-active' : ''}`}
                      aria-current={tab === tabItem.id ? 'page' : undefined}
                      onClick={() => { setTab(tabItem.id); setSectionOpen(false); }}
                      data-tab={tabItem.id}
                    >
                      <tabItem.icon />
                      {t(tabItem.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canAddUser && (
            <button
              type="button"
              onClick={() => setShowAddUser(true)}
              className="btn btn-secondary btn-sm"
              style={{ gap: 4 }}
              data-action="facility-add-user"
            >
              <UserPlus style={{ width: 13, height: 13 }} /> {t('hospitals.addUser')}
            </button>
          )}
          {canCreate && (
            <>
              <button type="button" onClick={onEdit} className="btn btn-secondary btn-sm" style={{ gap: 4 }} data-action="edit-facility">
                <Edit3 style={{ width: 13, height: 13 }} /> {t('orgHospitals.edit')}
              </button>
              <button
                type="button" onClick={onRetire} className="btn btn-secondary btn-sm" style={{ gap: 4 }}
                data-action={isFacilityActive(hospital) ? 'retire-facility' : 'restore-facility'}
              >
                {isFacilityActive(hospital)
                  ? <><Ban style={{ width: 13, height: 13 }} /> {t('orgHospitals.retire')}</>
                  : <><RotateCcw style={{ width: 13, height: 13 }} /> {t('orgHospitals.restore')}</>}
              </button>
            </>
          )}
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
          </button>
        </div>
      </div>

      <hr className="section-divider" />

      {/* The facility's record and the work done on it, on one screen. These
          sections were a separate page reached by a "Manage" button, then a tab
          strip here; they are now the menu beside Edit facility in the header
          above, so the panel opens on content rather than on navigation. */}
      {tab !== 'overview' && canManage ? (
        <FacilityManageTabs
          hospital={hospital}
          tab={tab}
          scope={scope}
          staffRefreshToken={staffRefreshToken}
          canWriteSettings={canWriteSettings}
          onHospitalSaved={onHospitalSaved}
        />
      ) : (
      <>
      {/* Quick stats row */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="icon-box-sm"><Users style={{ color: 'var(--accent-primary)' }} /></div><div className="kpi__body"><div className="kpi__value">{facilityCensus ? censusFor(facilityCensus, hospital._id).patients.toLocaleString() : '…'}</div><div className="kpi__label">{t('hospitals.statPatients')}</div></div></div>
        <div className="kpi"><div className="icon-box-sm"><Activity style={{ color: 'var(--accent-primary)' }} /></div><div className="kpi__body"><div className="kpi__value">{facilityCensus ? censusFor(facilityCensus, hospital._id).todayVisits : '…'}</div><div className="kpi__label">{t('hospitals.statToday')}</div></div></div>
        <div className="kpi"><div className="icon-box-sm"><BedDouble style={{ color: '#FFD2A6' }} /></div><div className="kpi__body"><div className="kpi__value">{hospital.totalBeds}</div><div className="kpi__label">{t('hospitals.statBeds')}</div></div></div>
        <div className="kpi"><div className="icon-box-sm"><Stethoscope style={{ color: '#FFD2A6' }} /></div><div className="kpi__body"><div className="kpi__value">{totalStaff}</div><div className="kpi__label">{t('hospitals.statStaff')}</div></div></div>
      </div>

      <hr className="section-divider" />

      {/* Performance Metrics — horizontal bar chart style */}
      {hospital.performance && (
        <div className="card-elevated" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Eye style={{ width: 14, height: 14, color: 'var(--text-muted)' }} /> {t('hospitals.performanceMetrics')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...PERCENTAGE_METRICS, 'stockOutDays' as PerformanceMetricKey, 'opdVisitsPerMonth' as PerformanceMetricKey].map(key => {
              const val = hospital.performance![key as keyof typeof hospital.performance] as number;
              const norm = normalizeMetricForColor(key, val);
              const barWidth = PERCENTAGE_METRICS.includes(key) ? val : norm;
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 90, flexShrink: 0 }}>{METRIC_LABELS[key]}</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--overlay-subtle)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, barWidth)}%`, height: '100%', borderRadius: 3, background: getPerformanceColor(norm), transition: 'width 0.3s' }} />
                  </div>
                  <span className="stat-value" style={{ fontSize: 12, fontWeight: 700, color: getPerformanceColor(norm), minWidth: 40, textAlign: 'end' }}>
                    {formatMetricValue(key, val)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <hr className="section-divider" />

      {/* Sparkline + Services — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Trend */}
        {hospital.monthlyTrends && hospital.monthlyTrends.length > 0 && (
          <div className="card-elevated" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{t('hospitals.sixMonthTrend')}</div>
            {hospital.monthlyTrends.every(m => !m.opdVisits && !m.reportingTimeliness) ? (
              <div style={{ height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)' }}>—</div>
            ) : (
            <ResponsiveContainer width="100%" height={50}>
              <LineChart data={hospital.monthlyTrends} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <Line type="monotone" dataKey="opdVisits" stroke="var(--accent-primary)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="reportingTimeliness" stroke="var(--color-success)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 2, borderRadius: 1, background: 'var(--accent-primary)' }} />{t('hospitals.legendOpd')}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 2, borderRadius: 1, background: 'var(--color-success)' }} />{t('hospitals.legendReporting')}</span>
            </div>
          </div>
        )}

        {/* Beds breakdown */}
        <div className="card-elevated" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{t('hospitals.bedsHeader', { count: hospital.totalBeds })}</div>
          <div className="data-row-divider-sm" style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Same as the staff rows above: the colour chips keyed to nothing,
                and "ICU" in danger red read as an alert about a ward type. */}
            {[
              { label: t('hospitals.bedsIcu'), value: hospital.icuBeds },
              { label: t('hospitals.bedsMaternity'), value: hospital.maternityBeds },
              { label: t('hospitals.bedsPediatric'), value: hospital.pediatricBeds },
              { label: t('hospitals.bedsGeneral'), value: Math.max(0, hospital.totalBeds - hospital.icuBeds - hospital.maternityBeds - hospital.pediatricBeds) },
              // Ward-derived; '—' until the facility has ward documents, so
              // an unmeasured facility never reads as 0% (or a fake constant).
              { label: t('hospitals.occupancyEstimated'), value: (occupancyPct === null ? '—' : `${occupancyPct}%`) as number | string },
            ].map(b => (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{b.label}</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{b.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <hr className="section-divider" />

      {/* Staff + Services + Infrastructure — compact */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Staff */}
        <div className="card-elevated" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{t('hospitals.staffHeader', { count: totalStaff })}</div>
          <div className="data-row-divider-sm" style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Plain label/value rows. Each role used to carry a coloured dot
                that keyed to nothing — no chart, no legend, no status — and one
                of the five colours was a raw off-palette hex. */}
            {[
              { label: t('hospitals.staffDoctors'), value: hospital.doctors },
              { label: t('hospitals.staffClinicalOfficers'), value: hospital.clinicalOfficers },
              { label: t('hospitals.staffNurses'), value: hospital.nurses },
              { label: t('hospitals.staffLabTech'), value: hospital.labTechnicians },
              { label: t('hospitals.staffPharmacists'), value: hospital.pharmacists },
              // The establishment above is what the facility is staffed FOR;
              // this is who can sign in. The difference is the provisioning
              // gap, and it belongs next to the number it contradicts.
              { label: t('hospitals.staffAccounts'), value: staffAccounts ?? '—' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Infrastructure */}
        <div className="card-elevated" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{t('hospitals.infrastructure')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {hospital.hasElectricity ? <InfraBadge icon={Zap} label={t('hospitals.infraPower')} color="#FDD95F" bg="rgba(253, 217, 95,0.10)" />
              : <InfraBadge icon={ZapOff} label={t('hospitals.infraNoPower')} color="#94A2B3" bg="rgba(93, 114, 139,0.10)" />}
            {hospital.hasGenerator && <InfraBadge icon={Activity} label={t('hospitals.infraGenerator')} color="var(--color-success-text)" bg="rgba(15, 160, 106,0.10)" />}
            {hospital.hasSolar && <InfraBadge icon={Sun} label={t('hospitals.infraSolar')} color="#FDD95F" bg="rgba(253, 217, 95,0.08)" />}
            {hospital.hasInternet ? <InfraBadge icon={Signal} label={hospital.internetType} color="var(--accent-primary)" bg="rgba(30, 144, 255,0.10)" />
              : <InfraBadge icon={WifiOff} label={t('hospitals.infraNoInternet')} color="#94A2B3" bg="rgba(93, 114, 139,0.10)" />}
            {hospital.hasAmbulance && <InfraBadge icon={Truck} label={t('hospitals.infraAmbulance')} color="var(--color-danger-text)" bg="rgba(224, 49, 39,0.08)" />}
            {hospital.emergency24hr && <InfraBadge icon={HeartPulse} label={t('hospitals.infra24hrEr')} color="var(--color-danger-text)" bg="rgba(224, 49, 39,0.08)" />}
          </div>
          {hospital.electricityHours > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{t('hospitals.infraPower')}</span>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--overlay-subtle)', overflow: 'hidden' }}>
                <div style={{ width: `${(hospital.electricityHours / 24) * 100}%`, height: '100%', borderRadius: 2, background: hospital.electricityHours >= 12 ? 'var(--color-success)' : hospital.electricityHours >= 6 ? 'var(--color-warning)' : 'var(--color-danger)' }} />
              </div>
              <span className="stat-value" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{hospital.electricityHours}h</span>
            </div>
          )}
        </div>
      </div>

      <hr className="section-divider" />

      {/* Services + Sync */}
      {hospital.serviceFlags && (
        <div className="card-elevated" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{t('hospitals.servicesAvailable')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(SERVICE_FLAG_ICONS).map(([key, { icon: FlagIcon, labelKey }]) => {
              const available = (hospital.serviceFlags as Record<string, boolean>)?.[key];
              return (
                <span key={key} className="badge" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, background: available ? 'rgba(17, 116, 180,0.08)' : 'rgba(93, 114, 139,0.06)', color: available ? 'var(--accent-primary)' : 'var(--text-muted)', opacity: available ? 1 : 0.5 }}>
                  <FlagIcon style={{ width: 11, height: 11 }} /> {t(labelKey)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer: sync + GPS */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', padding: '8px 0', borderTop: '1px solid var(--border-light)' }}>
        {/* The sync dot + "last synced" line are gone: both read fields frozen
            at record creation, so they asserted a replication state nothing
            measures. */}
        <span />
        <span className="font-mono">{(hospital.lat ?? 0).toFixed(4)}°N, {(hospital.lng ?? 0).toFixed(4)}°E{hospital.county && ` | ${hospital.county}`}</span>
      </div>
      </>
      )}

      {showAddUser && (
        <CreateUserModal
          hospitals={[hospital]}
          presetHospitalId={hospital._id}
          lockFacility
          onClose={() => setShowAddUser(false)}
          onCreated={(credentials) => {
            setShowAddUser(false);
            // The temporary password is unrecoverable once this closes.
            setUserHandoff(credentials);
            // Land on the roster the new account just joined, and make it
            // re-read: the Staff section is a different component.
            setStaffRefreshToken(token => token + 1);
            setTab('staff');
          }}
        />
      )}
      {userHandoff && (
        <CredentialHandoffModal
          title={t('orgUsers.handoffCreatedTitle')}
          description={t('orgUsers.handoffDescription')}
          username={userHandoff.username}
          password={userHandoff.password}
          invitation={userHandoff.invitation}
          onClose={() => setUserHandoff(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Small helper components
// ═══════════════════════════════════════════

function InfraBadge({ icon: Icon, label, color, bg }: { icon: React.ElementType; label: string; color: string; bg: string }) {
  return (
    <span className="badge text-[10px]" style={{ background: bg, color }}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

/**
 * The facility network — every facility in scope, its performance, and the
 * profile behind each one (staff, wards, equipment, inventory, schedules,
 * performance, settings) plus create / edit / retire.
 *
 * This was the page at /hospitals, titled "Health Facility Performance". That
 * route is gone (2026-08-23): a facility belongs to an organization, and
 * asking an operator to leave the organization they are looking at, open a
 * national list and filter their way back to it was a navigation that only
 * made sense when the two screens were built at different times. It is a
 * component now, hosted by /admin/organizations, which is the page that
 * answers "who runs what".
 *
 * `filterByScope` still decides which facilities a role sees, exactly as it
 * did here — the move changes the address, not the tenancy barrier.
 */
export default function FacilityNetworkView() {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>{t('status.loading')}</div>}>
      <HospitalsPageInner />
    </Suspense>
  );
}
