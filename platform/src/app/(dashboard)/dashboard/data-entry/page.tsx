'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useToast } from '@/components/Toast';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { formatDateTitle, toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import { formatClockTime } from '@/lib/format-utils';
import {
  ClipboardCheck, Baby, Skull, Syringe, HeartPulse,
  Database, Building2, ArrowRight, CheckCircle2, AlertTriangle,
  Heart, BedDouble, Stethoscope, Users, Zap, Save, Plus,
  Thermometer, Pill, FlaskConical, Droplets,
  ShieldCheck, Truck, FileText,
} from '@/components/icons/lucide';

// Use the platform accent token so this dashboard matches the reference
// Clinical Officer design instead of a one-off hardcoded hex.
const ACCENT = 'var(--accent-primary)';

interface CensusData {
  date: string;
  // Patients
  inpatientsTotal: number;
  inpatientsMale: number;
  inpatientsFemale: number;
  inpatientsChildren: number;
  opdVisitsToday: number;
  emergencyVisits: number;
  maternityAdmissions: number;
  newborns: number;
  deaths: number;
  discharges: number;
  referralsOut: number;
  referralsIn: number;
  // Beds
  totalBeds: number;
  occupiedBeds: number;
  icuBeds: number;
  icuOccupied: number;
  maternityBeds: number;
  maternityOccupied: number;
  pediatricBeds: number;
  pediatricOccupied: number;
  // Staff present
  doctorsPresent: number;
  nursesPresent: number;
  clinicalOfficers: number;
  labTechs: number;
  pharmacists: number;
  supportStaff: number;
  // Equipment & supplies
  functionalThermometers: number;
  functionalBPMonitors: number;
  functionalStethoscopes: number;
  functionalOximeters: number;
  wheelchairsAvailable: number;
  ambulanceOperational: boolean;
  generatorFunctional: boolean;
  waterAvailable: boolean;
  electricityHoursToday: number;
  // Pharmacy & lab
  tracerMedicinesInStock: number;
  tracerMedicinesTotal: number;
  stockOutItems: string;
  labTestsPerformed: number;
  labTestsPending: number;
  bloodUnitsAvailable: number;
  // Infection control
  handwashStations: number;
  handwashFunctional: number;
  wasteDisposalFunctional: boolean;
  ppeSetsAvailable: number;
  // Notes
  challenges: string;
  achievements: string;
  urgentNeeds: string;
}

// A saved report as displayed in the worklist: the census payload plus the
// real submission timestamp/author from the wrapping FacilityCensusDoc (the
// census payload itself is just numbers/text — no time or author of its own).
type SavedCensusReport = CensusData & { _submittedAt?: string; _submittedBy?: string };

function formatTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  return formatClockTime(iso) || undefined;
}

const emptyCensus = (date: string): CensusData => ({
  date,
  inpatientsTotal: 0, inpatientsMale: 0, inpatientsFemale: 0, inpatientsChildren: 0,
  opdVisitsToday: 0, emergencyVisits: 0, maternityAdmissions: 0, newborns: 0,
  deaths: 0, discharges: 0, referralsOut: 0, referralsIn: 0,
  totalBeds: 0, occupiedBeds: 0, icuBeds: 0, icuOccupied: 0,
  maternityBeds: 0, maternityOccupied: 0, pediatricBeds: 0, pediatricOccupied: 0,
  doctorsPresent: 0, nursesPresent: 0, clinicalOfficers: 0, labTechs: 0, pharmacists: 0, supportStaff: 0,
  functionalThermometers: 0, functionalBPMonitors: 0, functionalStethoscopes: 0, functionalOximeters: 0,
  wheelchairsAvailable: 0, ambulanceOperational: false, generatorFunctional: false, waterAvailable: true, electricityHoursToday: 0,
  tracerMedicinesInStock: 0, tracerMedicinesTotal: 20, stockOutItems: '', labTestsPerformed: 0, labTestsPending: 0, bloodUnitsAvailable: 0,
  handwashStations: 0, handwashFunctional: 0, wasteDisposalFunctional: true, ppeSetsAvailable: 0,
  challenges: '', achievements: '', urgentNeeds: '',
});

export default function DataEntryDashboard() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { hospitals } = useHospitals();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const today = new Date().toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [census, setCensus] = useState<CensusData>(() => emptyCensus(today));
  const [savedReports, setSavedReports] = useState<SavedCensusReport[]>([]);
  const [saving, setSaving] = useState(false);
  // Free-text filter over the saved-report worklist (search by date).
  const [reportSearch, setReportSearch] = useState('');

  const myHospital = useMemo(() =>
    hospitals.find(h => h._id === currentUser?.hospitalId),
    [hospitals, currentUser?.hospitalId]
  );

  const facilityStats = useMemo(() => {
    if (!myHospital) return null;
    const services = myHospital.services || [];
    const completeness = [
      myHospital.totalBeds > 0, myHospital.doctors > 0, myHospital.nurses > 0,
      services.length > 0, myHospital.hasElectricity, myHospital.hasInternet,
      myHospital.state, myHospital.county,
    ].filter(Boolean).length;
    return { services, pct: Math.round((completeness / 8) * 100), completeness };
  }, [myHospital]);

  const updateField = useCallback(<K extends keyof CensusData>(field: K, value: CensusData[K]) => {
    setCensus(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { saveFacilityCensus, getFacilityCensusByFacility } = await import('@/lib/services/facility-census-service');
      const facilityId = currentUser?.hospitalId || 'unknown';
      await saveFacilityCensus({
        facilityId,
        facilityName: myHospital?.name,
        orgId: currentUser?.orgId,
        date: census.date,
        census: census as unknown as Record<string, unknown>,
        submittedBy: currentUser?._id,
        submittedByName: currentUser?.name,
      });
      const updated = await getFacilityCensusByFacility(facilityId);
      setSavedReports(updated.map(r => ({ ...(r.census as unknown as CensusData), _submittedAt: r.createdAt, _submittedBy: r.submittedByName })).slice(0, 30));
      showToast(t('dataEntry.toastSaved'), 'success');
      setShowForm(false);
    } catch {
      showToast(t('dataEntry.toastSaveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Load saved reports + pre-fill from hospital data on mount / when the
  // hospital becomes available. (This was previously a `useState(() => {...})`
  // misuse that calls setters during state initialization — which both
  // skipped re-runs once the hospital loaded and triggered the React
  // "cannot update during render" warning.)
  useEffect(() => {
    let cancelled = false;
    async function loadSavedReports() {
      try {
        const { getFacilityCensusByFacility } = await import('@/lib/services/facility-census-service');
        const facilityId = currentUser?.hospitalId || 'unknown';
        const existing = await getFacilityCensusByFacility(facilityId);
        if (!cancelled) setSavedReports(existing.map(r => ({ ...(r.census as unknown as CensusData), _submittedAt: r.createdAt, _submittedBy: r.submittedByName })).slice(0, 30));
      } catch {
        if (!cancelled) setSavedReports([]);
      }
    }
    loadSavedReports();
    return () => { cancelled = true; };
  }, [currentUser?.hospitalId]);

  useEffect(() => {
    if (!myHospital) return;
    setCensus(prev => ({
      ...prev,
      totalBeds: myHospital.totalBeds || 0,
      icuBeds: myHospital.icuBeds || 0,
      maternityBeds: myHospital.maternityBeds || 0,
      pediatricBeds: myHospital.pediatricBeds || 0,
      doctorsPresent: myHospital.doctors || 0,
      nursesPresent: myHospital.nurses || 0,
      clinicalOfficers: myHospital.clinicalOfficers || 0,
      labTechs: myHospital.labTechnicians || 0,
      pharmacists: myHospital.pharmacists || 0,
    }));
  }, [myHospital]);

  const numField = (label: string, field: keyof CensusData, icon?: React.ElementType) => {
    const Icon = icon;
    return (
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          {Icon && <Icon className="w-3 h-3" />}
          {label}
        </label>
        <input
          type="number" min={0}
          value={census[field] as number}
          onChange={e => updateField(field, parseInt(e.target.value) || 0)}
          className="w-full px-3 py-2 rounded-md text-sm font-semibold"
          style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
        />
      </div>
    );
  };

  const boolField = (label: string, field: keyof CensusData) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <button type="button" onClick={() => updateField(field, !census[field] as CensusData[typeof field])}
        className="tbn-toggle" style={{ background: census[field] ? 'var(--accent-primary)' : 'var(--toggle-track)' }}>
        <span className="tbn-toggle__knob" style={{ transform: census[field] ? 'translateX(22px)' : 'translateX(3px)' }} />
      </button>
    </div>
  );

  const textField = (label: string, field: keyof CensusData, placeholder: string) => (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <textarea
        rows={2} placeholder={placeholder}
        value={census[field] as string}
        onChange={e => updateField(field, e.target.value as CensusData[typeof field])}
        className="w-full px-3 py-2 rounded-md text-xs"
        style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', resize: 'vertical' }}
      />
    </div>
  );

  const sectionHeader = (icon: React.ElementType, title: string, color: string) => {
    const Icon = icon;
    return (
      <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: '1px solid var(--border-medium)' }}>
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</span>
      </div>
    );
  };

  // Latest report drives the KPI metrics in the right rail.
  const latest = savedReports[0] || null;
  const bedOccupancy = latest && latest.totalBeds > 0 ? Math.round((latest.occupiedBeds / latest.totalBeds) * 100) : 0;
  const medAvailability = latest && latest.tracerMedicinesTotal > 0 ? Math.round((latest.tracerMedicinesInStock / latest.tracerMedicinesTotal) * 100) : 0;

  // Search filter over the saved-report worklist (matches on report date).
  const filteredReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    if (!q) return savedReports;
    return savedReports.filter(r => r.date.toLowerCase().includes(q));
  }, [savedReports, reportSearch]);

  const dateLabel = formatDateTitle(toIsoDate(new Date()));

  // Expandable per-report breakdown (patient census / beds & staff / equipment
  // & supplies), rendered inline via `row.popupDetail` (EhrCareDashboard's
  // shared expand-in-place panel). Inpatients/OPD/general-bed occupancy are
  // already on the row above, so those are left out here — everything below
  // is data the row has no column for.
  const renderReportDetail = (r: CensusData) => {
    const medAvail = r.tracerMedicinesTotal > 0 ? Math.round((r.tracerMedicinesInStock / r.tracerMedicinesTotal) * 100) : 0;
    const handwash = r.handwashStations > 0 ? Math.round((r.handwashFunctional / r.handwashStations) * 100) : 0;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ margin: '4px 0 12px' }}>
        {/* Patient summary */}
        <div className="glass-section">
          <div className="glass-section-header">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dataEntry.patientCensus')}</span>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {[
              { label: t('encounters.emergency'), value: r.emergencyVisits, color: 'var(--color-danger-text)' },
              { label: t('dashboard.bedMaternity'), value: r.maternityAdmissions, color: 'var(--accent-primary)' },
              { label: t('dataEntry.newborns'), value: r.newborns, color: 'var(--accent-primary)' },
              { label: t('dataEntry.discharges'), value: r.discharges, color: 'var(--accent-primary)' },
              { label: t('dataEntry.deaths'), value: r.deaths, color: 'var(--color-danger-text)' },
              { label: t('dataEntry.referralsOut'), value: r.referralsOut, color: 'var(--accent-primary)' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                <span className="text-sm font-bold" style={{ color: row.color }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bed & staff summary */}
        <div className="glass-section">
          <div className="glass-section-header">
            <div className="flex items-center gap-2">
              <BedDouble className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dataEntry.bedsAndStaff')}</span>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {[
              { label: t('dashboard.bedIcu'), occupied: r.icuOccupied, total: r.icuBeds, color: 'var(--color-danger-text)' },
              { label: t('dashboard.bedMaternity'), occupied: r.maternityOccupied, total: r.maternityBeds, color: 'var(--chart-2)' },
              { label: t('dashboard.bedPediatric'), occupied: r.pediatricOccupied, total: r.pediatricBeds, color: 'var(--color-brand-500)' },
            ].map(bed => {
              const pct = bed.total > 0 ? Math.round((bed.occupied / bed.total) * 100) : 0;
              return (
                <div key={bed.label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{bed.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: pct > 90 ? 'var(--color-danger-text)' : 'var(--text-secondary)' }}>{bed.occupied}/{bed.total}</span>
                  </div>
                  <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-medium)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bed.color }} />
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: '1px solid var(--border-medium)', paddingTop: 8, marginTop: 4 }}>
              <div className="text-[10px] font-semibold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>{t('dataEntry.staffPresent')}</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: t('dashboard.doctors'), value: r.doctorsPresent },
                  { label: t('dataEntry.nurses'), value: r.nursesPresent },
                  { label: t('dataEntry.cos'), value: r.clinicalOfficers },
                  { label: t('dataEntry.lab'), value: r.labTechs },
                  { label: t('dataEntry.pharma'), value: r.pharmacists },
                  { label: t('dataEntry.support'), value: r.supportStaff },
                ].map(s => (
                  <div key={s.label} className="text-center p-1.5 rounded" style={{ background: 'var(--overlay-subtle)' }}>
                    <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.value}</div>
                    <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Equipment & supplies */}
        <div className="glass-section">
          <div className="glass-section-header">
            <div className="flex items-center gap-2">
              <Thermometer className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dataEntry.equipmentSupplies')}</span>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {[
              { label: t('dataEntry.thermometers'), value: r.functionalThermometers, icon: Thermometer },
              { label: t('dataEntry.bpMonitors'), value: r.functionalBPMonitors, icon: Heart },
              { label: t('dataEntry.stethoscopes'), value: r.functionalStethoscopes, icon: Stethoscope },
              { label: t('dataEntry.pulseOximeters'), value: r.functionalOximeters, icon: Zap },
              { label: t('dataEntry.wheelchairs'), value: r.wheelchairsAvailable, icon: Truck },
              { label: t('dataEntry.ppeSets'), value: r.ppeSetsAvailable, icon: ShieldCheck },
            ].map(eq => (
              <div key={eq.label} className="flex items-center justify-between py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{eq.label}</span>
                </div>
                <span className="text-sm font-bold" style={{ color: eq.value > 0 ? 'var(--text-primary)' : 'var(--color-danger-text)' }}>{eq.value}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border-medium)', paddingTop: 8, marginTop: 4 }}>
              {[
                { label: t('dataEntry.medicineAvailability'), pct: medAvail, color: 'var(--color-success-text)' },
                { label: t('dataEntry.handwashStations'), pct: handwash, color: 'var(--accent-primary)' },
              ].map(m => (
                <div key={m.label} className="mb-2">
                  <div className="flex justify-between mb-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{m.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: m.pct >= 80 ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>{m.pct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-medium)' }}>
                    <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: m.color }} />
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3 mt-2">
                {[
                  { label: t('dataEntry.ambulance'), ok: r.ambulanceOperational },
                  { label: t('dataEntry.generator'), ok: r.generatorFunctional },
                  { label: t('dataEntry.water'), ok: r.waterAvailable },
                  { label: t('dataEntry.waste'), ok: r.wasteDisposalFunctional },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-1">
                    {s.ok ? <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--color-success)' }} /> : <AlertTriangle className="w-3 h-3" style={{ color: 'var(--color-danger)' }} />}
                    <span className="text-[9px] font-semibold" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!currentUser) return null;

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <EhrCareDashboard
        title={t('dataEntry.title')}
        greetingName={currentUser?.name}
        dateLabel={dateLabel}
        tabs={[
          { key: 'all', label: t('dataEntry.previousReports', { count: filteredReports.length }) },
        ]}
        // "Previous reports" spans many days; the rows carry their report date,
        // so the default day-scoping hid every report not filed on the selected
        // day while the tab kept counting them all.
        filterRowsByDate={false}
        activeTab="all"
        onTabChange={() => {}}
        searchValue={reportSearch}
        searchPlaceholder={t('topbar.searchPlaceholder')}
        onSearchChange={setReportSearch}
        filters={[]}
        actions={[
          { label: t('dataEntry.newCensus'), icon: Plus, onClick: () => setShowForm(true), tone: 'primary', tourTarget: 'data-entry-new-census' },
          { label: t('dataEntry.facilityAssessment'), icon: Building2, onClick: () => router.push('/facility-assessments') },
          { label: t('dataEntry.dataQuality'), icon: Database, onClick: () => router.push('/data-quality') },
          { label: t('dataEntry.vitalStatistics'), icon: Heart, onClick: () => router.push('/vital-statistics') },
          { label: t('nav.immunizations'), icon: Syringe, onClick: () => router.push('/immunizations') },
          { label: t('nav.anc'), icon: HeartPulse, onClick: () => router.push('/anc') },
          { label: t('dataEntry.births'), icon: Baby, onClick: () => router.push('/births') },
          { label: t('dataEntry.deaths'), icon: Skull, onClick: () => router.push('/deaths') },
        ]}
        // Reports carry a real submission time (the census payload's `date`
        // is just the reporting day); high-occupancy reports stay open,
        // matching the done→series1 default for everything else.
        chartSeriesNames={['High Occupancy', 'Normal']}
        rows={filteredReports.map((r, i): EhrCareDashboardRow => {
          const occ = r.totalBeds > 0 ? Math.round((r.occupiedBeds / r.totalBeds) * 100) : 0;
          return {
            id: `${r.date}-${i}`,
            title: r.date,
            subtitle: `${t('dataEntry.inpatientsCount', { count: r.inpatientsTotal })} · ${t('dataEntry.opdCount', { count: r.opdVisitsToday })}`,
            compactMeta: t('dataEntry.bedsCount', { occupied: r.occupiedBeds, total: r.totalBeds }),
            date: r.date,
            time: formatTime(r._submittedAt),
            timeSecondary: r.date,
            careTeam: r._submittedBy,
            careTeamLabel: 'Submitted by',
            location: t('dataEntry.bedsCount', { occupied: r.occupiedBeds, total: r.totalBeds }),
            locationSecondary: `${t('dataEntry.opdCount', { count: r.opdVisitsToday })}`,
            statusLabel: r.totalBeds > 0 ? `${occ}% occupied` : undefined,
            statusSecondary: occ > 90 ? 'Critical capacity' : occ > 70 ? 'High occupancy' : 'Normal capacity',
            statusTone: occ > 90 ? 'danger' : occ > 70 ? 'warning' : 'done',
            popupDetail: renderReportDetail(r),
          };
        })}
        metrics={[
          { label: t('dataEntry.kpiFacilityScore'), value: facilityStats ? `${facilityStats.pct}%` : '--', tone: facilityStats ? (facilityStats.pct >= 80 ? 'success' : 'warning') : 'neutral' },
          { label: t('dashboard.bedOccupancy'), value: latest ? `${bedOccupancy}%` : '--', tone: bedOccupancy > 90 ? 'danger' : bedOccupancy > 70 ? 'warning' : 'success' },
          { label: t('dataEntry.kpiMedicineAvail'), value: latest ? `${medAvailability}%` : '--', tone: medAvailability >= 80 ? 'success' : medAvailability >= 50 ? 'warning' : 'danger' },
          { label: t('dataEntry.kpiReportsFiled'), value: savedReports.length },
          { label: t('dataEntry.dailyCensus'), value: (!!latest && latest.date === today) ? t('patientPortal.done') : t('patientPortal.pending'), tone: (!!latest && latest.date === today) ? 'success' : 'warning', onClick: () => setShowForm(true) },
        ]}
        metricsTitle={t('dataEntry.title')}
        missionTitle={myHospital?.name}
        missionDescription={myHospital ? `${myHospital.state} · ${myHospital.county || myHospital.town} · ${myHospital.type?.replace(/_/g, ' ') ?? ''}` : undefined}
        centerSubtitle={savedReports.length === 0 ? t('dataEntry.noReportsDesc') : undefined}
        emptyTitle={t('dataEntry.noReportsYet')}
        emptyActionLabel={t('dataEntry.startDailyCensus')}
        onEmptyAction={() => setShowForm(true)}
      >
        {/* ═══ CENSUS FORM MODAL ═══ */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto" style={{ background: 'rgba(0,0,0,0.55)', padding: '24px 16px' }}
            onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
            <div className="w-full max-w-2xl rounded-lg" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-xl)' }}>

              {/* Form header */}
              <div data-tour="census-form-header" className="sticky top-0 z-10 flex items-center justify-between p-4 rounded-t-lg" style={{ background: 'var(--bg-card-solid)', borderBottom: '1px solid var(--border-medium)' }}>
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5" style={{ color: ACCENT }} />
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('dataEntry.dailyFacilityCensus')}</h3>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{myHospital?.name || t('dataEntry.unknownFacility')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="date" value={census.date} onChange={e => updateField('date', e.target.value)}
                    className="px-2 py-1 rounded text-xs" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} />
                  <button onClick={() => setShowForm(false)} className="w-7 h-7 rounded flex items-center justify-center"
                    style={{ background: 'var(--overlay-medium)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>×</button>
                </div>
              </div>

              <div className="p-4 space-y-5">

                {/* 1. Patient Census */}
                {sectionHeader(Users, t('dataEntry.patientCensus'), 'var(--accent-primary)')}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {numField(t('dataEntry.inpatientsTotal'), 'inpatientsTotal', Users)}
                  {numField(t('patient.male'), 'inpatientsMale')}
                  {numField(t('patient.female'), 'inpatientsFemale')}
                  {numField(t('dataEntry.childrenUnder5'), 'inpatientsChildren')}
                  {numField(t('dataEntry.opdVisits'), 'opdVisitsToday')}
                  {numField(t('encounters.emergency'), 'emergencyVisits')}
                  {numField(t('dataEntry.maternityAdmissions'), 'maternityAdmissions')}
                  {numField(t('dataEntry.newborns'), 'newborns', Baby)}
                  {numField(t('dataEntry.deaths'), 'deaths', Skull)}
                  {numField(t('dataEntry.discharges'), 'discharges')}
                  {numField(t('dataEntry.referralsOut'), 'referralsOut', ArrowRight)}
                  {numField(t('dataEntry.referralsIn'), 'referralsIn')}
                </div>

                {/* 2. Bed Occupancy */}
                {sectionHeader(BedDouble, t('dashboard.bedOccupancy'), 'var(--accent-primary)')}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {numField(t('dataEntry.totalBeds'), 'totalBeds', BedDouble)}
                  {numField(t('dataEntry.occupied'), 'occupiedBeds')}
                  {numField(t('dataEntry.icuBeds'), 'icuBeds')}
                  {numField(t('dataEntry.icuOccupied'), 'icuOccupied')}
                  {numField(t('dataEntry.maternityBeds'), 'maternityBeds')}
                  {numField(t('dataEntry.maternityOccupied'), 'maternityOccupied')}
                  {numField(t('dataEntry.pediatricBeds'), 'pediatricBeds')}
                  {numField(t('dataEntry.pediatricOccupied'), 'pediatricOccupied')}
                </div>

                {/* 3. Staff Present */}
                {sectionHeader(Stethoscope, t('dataEntry.staffPresentToday'), 'var(--color-success)')}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {numField(t('dashboard.doctors'), 'doctorsPresent', Stethoscope)}
                  {numField(t('dataEntry.nurses'), 'nursesPresent', Users)}
                  {numField(t('dataEntry.clinicalOfficers'), 'clinicalOfficers')}
                  {numField(t('dataEntry.labTechnicians'), 'labTechs', FlaskConical)}
                  {numField(t('dataEntry.pharmacists'), 'pharmacists', Pill)}
                  {numField(t('dataEntry.supportStaff'), 'supportStaff')}
                </div>

                {/* 4. Equipment */}
                {sectionHeader(Thermometer, t('dataEntry.functionalEquipment'), 'var(--color-warning)')}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {numField(t('dataEntry.thermometers'), 'functionalThermometers', Thermometer)}
                  {numField(t('dataEntry.bpMonitors'), 'functionalBPMonitors')}
                  {numField(t('dataEntry.stethoscopes'), 'functionalStethoscopes', Stethoscope)}
                  {numField(t('dataEntry.pulseOximeters'), 'functionalOximeters')}
                  {numField(t('dataEntry.wheelchairs'), 'wheelchairsAvailable')}
                  {numField(t('dataEntry.ppeSets'), 'ppeSetsAvailable', ShieldCheck)}
                </div>
                <div className="grid grid-cols-2 gap-x-6">
                  {boolField(t('dataEntry.ambulanceOperational'), 'ambulanceOperational')}
                  {boolField(t('dataEntry.generatorFunctional'), 'generatorFunctional')}
                  {boolField(t('dataEntry.waterAvailable'), 'waterAvailable')}
                  {boolField(t('dataEntry.wasteDisposalFunctional'), 'wasteDisposalFunctional')}
                </div>
                {numField(t('dataEntry.electricityHoursToday'), 'electricityHoursToday', Zap)}

                {/* 5. Pharmacy & Lab */}
                {sectionHeader(Pill, t('dataEntry.pharmacyLaboratory'), 'var(--chart-2)')}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {numField(t('dataEntry.tracerMedicinesInStock'), 'tracerMedicinesInStock', Pill)}
                  {numField(t('dataEntry.tracerMedicinesTotal'), 'tracerMedicinesTotal')}
                  {numField(t('dataEntry.labTestsDone'), 'labTestsPerformed', FlaskConical)}
                  {numField(t('dataEntry.labTestsPending'), 'labTestsPending')}
                  {numField(t('dataEntry.bloodUnitsAvailable'), 'bloodUnitsAvailable', Droplets)}
                </div>
                {textField(t('dataEntry.stockOutItems'), 'stockOutItems', t('dataEntry.stockOutItemsPlaceholder'))}

                {/* 6. Infection Control */}
                {sectionHeader(ShieldCheck, t('dataEntry.infectionControl'), 'var(--color-brand-500)')}
                <div className="grid grid-cols-2 gap-3">
                  {numField(t('dataEntry.handwashStations'), 'handwashStations')}
                  {numField(t('dataEntry.functionalStations'), 'handwashFunctional')}
                </div>

                {/* 7. Notes */}
                {sectionHeader(FileText, t('dataEntry.dailyNotes'), '#5A7370')}
                {textField(t('dataEntry.challenges'), 'challenges', t('dataEntry.challengesPlaceholder'))}
                {textField(t('dataEntry.achievements'), 'achievements', t('dataEntry.achievementsPlaceholder'))}
                {textField(t('dataEntry.urgentNeeds'), 'urgentNeeds', t('dataEntry.urgentNeedsPlaceholder'))}
              </div>

              {/* Save button */}
              <div className="sticky bottom-0 p-4 rounded-b-lg flex gap-3" style={{ background: 'var(--bg-card-solid)', borderTop: '1px solid var(--border-medium)' }}>
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-md text-xs font-semibold"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  {t('action.cancel')}
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2.5 rounded-md text-xs font-semibold inline-flex items-center justify-center gap-2"
                  style={{ background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                  <Save className="w-3.5 h-3.5" /> {saving ? t('nurse.savingDots') : t('dataEntry.saveCensusReport')}
                </button>
              </div>
            </div>
          </div>
        )}
      </EhrCareDashboard>
    </main>
  );
}
