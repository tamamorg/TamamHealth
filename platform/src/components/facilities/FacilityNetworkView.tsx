'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  BedDouble, Users, Stethoscope, WifiOff,
  Zap, ZapOff, Sun, Truck, Signal, Activity,
  MapPin, HeartPulse, X, Phone, Mail, UserPlus,
  FlaskConical, Download, Eye, Plus, Edit3, Ban, RotateCcw,
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
import { FACILITY_MANAGE_ROLES } from '@/lib/facility-access';
import { isFacilityActive } from '@/lib/services/hospital-service';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { FilterSelect } from '@/components/filters';
import { SadbCard, SadbChip, SadbSearch, SadbGridList, SadbGridRow, SadbKpiTile } from '@/components/admin/sadb-ui';
import Modal from '@/components/Modal';
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
/** "Aug 2026" — the same shape a tenant row carries under its name. */
function onboardedLabel(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** Grid: Facility (wide) · Type · Location · Beds · Staff · Status. */
const FACILITY_GRID = 'minmax(200px,1.6fr) repeat(5, minmax(96px,1fr))';

function HospitalsPageInner() {
  const { t } = useTranslation();
  const { hospitals, loading, reload: reloadHospitals } = useHospitals();
  const { globalSearch, currentUser } = useApp();
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
  const orgParam = searchParams.get('org');
  const stateParam = searchParams.get('state');
  const countyParam = searchParams.get('county');
  // Which tab the profile should open on when it was reached from the list's
  // gear menu rather than from a row click or a ?tab= link.
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState(() => stateParam || 'all');

  // `?facility=` (and the `?tab=` that may ride with it) used to open a panel
  // over this list. Both now belong to the facility's own page, so an inbound
  // link goes there instead of unfolding a card on top of the registry.
  const facilityIdParam = searchParams.get('facility');
  const facilityTabParam = searchParams.get('tab');
  useEffect(() => {
    if (!facilityIdParam) return;
    const query = facilityTabParam ? `?tab=${encodeURIComponent(facilityTabParam)}` : '';
    router.replace(`/admin/facilities/${encodeURIComponent(facilityIdParam)}${query}`);
  }, [facilityIdParam, facilityTabParam, router]);

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
        /* County, ownership and operational status were the Filters popover's
           columns; with the popover gone the search box has to carry them, so
           "public", "functional" and a county name each narrow the list. */
        const haystack = [
          h.name || '', h.state || '', h.county || '', h.town || '',
          h.facilityType || '', h.ownership || '', h.operationalStatus || '',
          ...(h.services || []),
        ].join(' ').toLowerCase();
        if (!terms.every(term => haystack.includes(term))) return false;
      }
      if (orgParam && h.orgId !== orgParam) return false;
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
  }, [hospitals, search, globalSearch, orgParam, filterState, filterCounty, filterType, filterOwnership, filterStatus, filterService]);

  // ── KPIs ──
  // Performance averages run over the facilities that HAVE performance data
  // only — `performance` is written by nothing in the app (it exists only on
  // seeded demo records), so averaging `|| 0` across every facility reported
  // "Avg reporting 0%" as a measured fact on real deployments. With no
  // measured facility at all the figures read '—', never a false zero.
  // The two counts the legend carries. Everything else the old stat strip
  // showed (reporting, readiness, coverage gaps, staff-per-bed) is a
  // performance figure and belongs on the facility's own Performance section,
  // not on a chip above the list.
  const functionalCount = hospitals.filter(h => isFacilityActive(h) && (h.operationalStatus ?? 'functional') === 'functional').length;
  const retiredCount = hospitals.filter(h => !isFacilityActive(h)).length;
  const totalBeds = hospitals.reduce((sum, h) => sum + (h.totalBeds || 0), 0);
  const totalStaff = hospitals.reduce((sum, h) => sum + (h.doctors || 0) + (h.nurses || 0) + (h.clinicalOfficers || 0), 0);


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
      {/* ═══ Network vitals — the same tile strip the organizations tab
          carries above its own registry. These four were a row of coloured
          stat chips on an EhrListHeader; as tiles they read the same way on
          both tabs, and the switch between them stops changing shape. ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile
          label={t('hospitals.kpiFacilities')}
          value={hospitals.length}
          delta={`${functionalCount} ${t('hospitals.statusFunctional').toLowerCase()}`}
          deltaTone={functionalCount > 0 ? 'up' : undefined}
        />
        <SadbKpiTile
          label={t('hospitals.colBeds')}
          value={totalBeds.toLocaleString()}
          delta={t('hospitals.acrossNetwork')}
        />
        <SadbKpiTile
          label={t('hospitals.colStaff')}
          value={totalStaff.toLocaleString()}
          delta={totalBeds ? t('hospitals.perBed', { value: (totalStaff / totalBeds).toFixed(1) }) : t('hospitals.acrossNetwork')}
        />
        <SadbKpiTile
          label={t('orgHospitals.retired')}
          value={retiredCount}
          delta={retiredCount > 0 ? t('hospitals.retiredNote') : t('hospitals.allInService')}
          deltaTone={retiredCount > 0 ? 'warn' : undefined}
        />
      </div>

      {/* ═══ The facility registry, in the organizations registry's own
          anatomy: a legend of counts on the card head, one search row, and a
          grid list whose rows open the facility's page.

          It used to be an EhrListHeader over a nine-column table, with the
          facility PROFILE rendered inline in place of that table — clicking a
          row replaced the list you were reading with one of its own rows. The
          organizations tab beside it stopped doing that when its rows started
          opening `/admin/organizations/[id]`; these rows open
          `/admin/facilities/[id]`, and the two tabs now read as one screen. ═══ */}
      <SadbCard
        title={t('orgAdmin.facilities')}
        action={
          <div className="sadb-legend">
            <span><i style={{ background: 'var(--text-muted)' }} />{t('orgAdmin.facilities')} ({hospitals.length})</span>
            <span><i style={{ background: 'var(--color-success-800)' }} />{t('hospitals.statusFunctional')} ({functionalCount})</span>
            {retiredCount > 0 && (
              <span><i style={{ background: 'var(--color-danger-500)' }} />{t('orgHospitals.retired')} ({retiredCount})</span>
            )}
          </div>
        }
      >
        <div className="sadb-search-row">
          <SadbSearch value={search} onChange={setSearch} placeholder={t('hospitals.searchPlaceholder')} />
          <button type="button" className="btn btn-secondary btn-sm flex-shrink-0" onClick={handleExport}>
            <Download className="w-4 h-4" /> {t('action.export')}
          </button>
          {canCreate && (
            <button type="button" className="btn btn-primary btn-sm flex-shrink-0" onClick={() => setShowCreateFacility(true)}>
              <Plus className="w-4 h-4" /> {t('orgHospitals.addFacility')}
            </button>
          )}
        </div>

        <SadbGridList
          template={FACILITY_GRID}
          minWidth={880}
          head={[
            t('hospitals.colFacility'), t('hospitals.colType'), t('hospitals.colLocation'),
            t('hospitals.colBeds'), t('hospitals.colStaff'), t('hospitals.colStatus'),
          ]}
          alignEndLast
          empty={loading ? t('hospitals.loadingFacilities') : t('hospitals.emptyFacilities')}
        >
          {filteredHospitals.map(h => {
            const retired = !isFacilityActive(h);
            const staff = (h.doctors || 0) + (h.nurses || 0) + (h.clinicalOfficers || 0);
            const onboarded = onboardedLabel(h.createdAt);
            return (
              <SadbGridRow
                key={h._id}
                template={FACILITY_GRID}
                onClick={() => router.push(`/admin/facilities/${h._id}`)}
              >
                <span className="min-w-0">
                  <span className="sadb-tenant-name truncate" style={{ color: retired ? 'var(--text-muted)' : undefined }}>
                    {h.name}
                  </span>
                  <span className="sadb-tenant-sub truncate">
                    {[
                      h.ownership ? t(OWNERSHIP_LABEL_KEYS[h.ownership]) : null,
                      onboarded ? t('orgAdmin.onboardedOn', { date: onboarded }) : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="truncate">
                  {TYPE_LABEL_KEYS[h.facilityType] ? t(TYPE_LABEL_KEYS[h.facilityType]) : h.facilityType}
                </span>
                <span className="truncate">{[h.town, h.state].filter(Boolean).join(', ') || '—'}</span>
                <span className="sadb-tenant-num">{h.totalBeds ?? 0}</span>
                <span className="sadb-tenant-num">{staff}</span>
                <span style={{ textAlign: 'end' }}>
                  <SadbChip tone={retired ? 'red' : 'green'}>
                    {retired ? t('orgHospitals.retired') : t(STATUS_LABEL_KEYS[h.operationalStatus || 'functional'])}
                  </SadbChip>
                </span>
              </SadbGridRow>
            );
          })}
        </SadbGridList>
      </SadbCard>

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
              showToast(t('orgHospitals.updatedToast', { name: hospital.name }), 'success');
            } else {
              setCreatedFacility(hospital.name);
              setTimeout(() => setCreatedFacility(null), 4000);
            }
          }}
          /* A tenant admin's own org always wins; for the super-admin, an
             inbound ?org= (the org page's "Add Facility") fixes the tenant so
             the dialog doesn't re-ask which org the operator just left. */
          orgId={currentUser?.orgId || orgParam || undefined}
          organizations={(currentUser?.orgId || orgParam) ? undefined : organizations}
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

/** The profile's own content is the first tab; the rest are the facility
 *  management tabs that used to be a page of their own. */
type ProfileTabId = 'overview' | FacilityTabId;

const PROFILE_TABS: { id: ProfileTabId; labelKey: string; icon: React.ElementType }[] = [
  { id: 'overview', labelKey: 'hospitals.tabOverview', icon: Eye },
  ...FACILITY_MANAGE_TABS,
];

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
      {/* The admin console's tile strip, the same one the registry above this
          page carries. It was an EHR icon-box row, which put a second visual
          language on a page reached from a Sadb list — and two of its glyphs
          were painted a raw #FFD2A6 that keyed to nothing. */}
      <div className="sadb-kpi-row">
        <SadbKpiTile
          label={t('hospitals.statPatients')}
          value={facilityCensus ? censusFor(facilityCensus, hospital._id).patients.toLocaleString() : '…'}
          delta={t('hospitals.registeredHere')}
        />
        <SadbKpiTile
          label={t('hospitals.statToday')}
          value={facilityCensus ? censusFor(facilityCensus, hospital._id).todayVisits : '…'}
          delta={t('hospitals.visitsToday')}
        />
        <SadbKpiTile
          label={t('hospitals.statBeds')}
          value={hospital.totalBeds}
          delta={occupancyPct === null ? t('hospitals.noOccupancy') : t('hospitals.occupancyDelta', { value: occupancyPct })}
        />
        <SadbKpiTile
          label={t('hospitals.statStaff')}
          value={totalStaff}
          delta={hospital.totalBeds ? t('hospitals.perBed', { value: (totalStaff / hospital.totalBeds).toFixed(1) }) : t('hospitals.establishedPosts')}
        />
      </div>

      {/* Performance Metrics — horizontal bar chart style */}
      {hospital.performance && (
        <SadbCard title={t('hospitals.performanceMetrics')}>
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
        </SadbCard>
      )}

      {/* Sparkline + Services — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Trend */}
        {hospital.monthlyTrends && hospital.monthlyTrends.length > 0 && (
          <SadbCard title={t('hospitals.sixMonthTrend')}>
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
          </SadbCard>
        )}

        {/* Beds breakdown */}
        <SadbCard title={t('hospitals.bedsHeader', { count: hospital.totalBeds })}>
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
        </SadbCard>
      </div>

      {/* Staff + Services + Infrastructure — compact */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Staff */}
        <SadbCard title={t('hospitals.staffHeader', { count: totalStaff })}>
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
        </SadbCard>

        {/* Infrastructure */}
        <SadbCard title={t('hospitals.infrastructure')}>
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
        </SadbCard>
      </div>

      {/* Services + Sync */}
      {hospital.serviceFlags && (
        <SadbCard title={t('hospitals.servicesAvailable')}>
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
        </SadbCard>
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
