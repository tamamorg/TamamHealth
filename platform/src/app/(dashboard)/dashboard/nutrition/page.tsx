'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import DemoModeBanner from '@/components/DemoModeBanner';
import Modal from '@/components/Modal';
import { useAuth } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useNutritionScreenings } from '@/lib/hooks/useNutritionScreenings';
import { classifyScreening } from '@/lib/services/nutrition-screening-service';
import { useNutritionSupplies } from '@/lib/hooks/useNutritionSupplies';
import { classifySupplyStatus } from '@/lib/services/nutrition-supply-service';
import type { NutritionFollowUpAction } from '@/lib/db-types';
import {
  AlertTriangle, CheckCircle2, TrendingDown,
  BarChart3, Utensils, Plus, X, ArrowRightLeft, HeartPulse,
} from '@/components/icons/lucide';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { formatDateTitle, toIsoDate } from '@/components/ehr/EhrMiniCalendar';
// The same patient lookup the lab order flow uses — generic over PatientDoc,
// not lab-specific — so a screening can link to a real chart instead of
// nowhere. Its `labord-*` styles are scoped and additive, matching how the
// lab order screens already pull this file in.
import LabOrderPatientPicker from '@/components/lab/order/LabOrderPatientPicker';
import '@/components/lab/order/lab-order.css';
import { patientFullName } from '@/lib/patient-utils';
import Select from '@/components/Select';

// Use the platform accent token so this dashboard matches the reference
// Clinical Officer design instead of a one-off hardcoded hex.
const ACCENT = 'var(--accent-primary)';

type Screening = {
  id: string; name: string; age: string; sex: string;
  muac: number; weight: number; height: number; edema: boolean;
  status: string; date: string;
  /** Full screening timestamp — only real (saved) screenings have one; demo
   *  rows only ever carry a date, so they render without a plotted time. */
  createdAt?: string;
  /** Staff member who recorded the screening — only real (saved) screenings
   *  carry one; demo rows render without a Source column instead of a
   *  fabricated name. */
  screenedBy?: string;
  /** Registered patient this screening is linked to, when one exists — lets
   *  the row's name open the chart. Screenings can precede registration, so
   *  this is frequently absent even on real (saved) rows. */
  patientId?: string;
  notes?: string;
  followUpAction?: NutritionFollowUpAction;
  /** True for persisted store docs (not demo sample rows). */
  persistable: boolean;
};

function formatTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

const EMPTY_FORM = { name: '', age: '', sex: 'F', muac: '', weight: '', height: '', edema: false, isAnc: false, notes: '' };

// Demo-only screenings + supply inventory. Gated on NEXT_PUBLIC_DEMO_MODE so
// production deploys render empty states instead of confusing staff with
// sample patient names.
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

const SAMPLE_SCREENINGS = [
  { id: 'ns-001', name: 'Akech Deng Mawien', age: '2y', sex: 'F', muac: 10.8, weight: 8.2, height: 78, edema: true, status: 'SAM', date: '2026-02-09' },
  { id: 'ns-002', name: 'Tut Chuol Both', age: '3y', sex: 'M', muac: 12.0, weight: 10.5, height: 88, edema: false, status: 'MAM', date: '2026-02-09' },
  { id: 'ns-003', name: 'Nyabol Koang Jal', age: '28w ANC', sex: 'F', muac: 21.5, weight: 52, height: 158, edema: false, status: 'Normal', date: '2026-02-09' },
  { id: 'ns-004', name: 'Deng Garang Majok', age: '18m', sex: 'M', muac: 11.2, weight: 7.1, height: 72, edema: false, status: 'SAM', date: '2026-02-08' },
  { id: 'ns-005', name: 'Achol Dut Machar', age: '4y', sex: 'F', muac: 13.0, weight: 13.8, height: 98, edema: false, status: 'At Risk', date: '2026-02-08' },
  { id: 'ns-006', name: 'Ajak Mading Kuol', age: '24w ANC', sex: 'F', muac: 19.8, weight: 48, height: 155, edema: false, status: 'Underweight', date: '2026-02-08' },
  { id: 'ns-007', name: 'Gatluak Puok Riek', age: '5y', sex: 'M', muac: 14.2, weight: 17, height: 108, edema: false, status: 'Normal', date: '2026-02-07' },
  { id: 'ns-008', name: 'Nyamal Gatdet Both', age: '11m', sex: 'F', muac: 12.3, weight: 6.8, height: 68, edema: false, status: 'MAM', date: '2026-02-07' },
];

// Starter items persisted once as real docs (via seedSuppliesIfEmpty) when the
// nutrition_supply store is empty in demo mode — see useNutritionSupplies.
// Production deploys never see this list; an empty facility renders the
// empty state and staff add real stock via "Add supply item".
const DEMO_SUPPLY_SEED = [
  { name: 'RUTF (Plumpy\'Nut)', unit: 'sachets', currentLevel: 120, reorderLevel: 50 },
  { name: 'F-75 Therapeutic Milk', unit: 'tins', currentLevel: 8, reorderLevel: 15 },
  { name: 'F-100 Therapeutic Milk', unit: 'tins', currentLevel: 22, reorderLevel: 10 },
  { name: 'ReSoMal (ORS)', unit: 'packets', currentLevel: 3, reorderLevel: 10 },
  { name: 'Vitamin A Capsules', unit: 'capsules', currentLevel: 200, reorderLevel: 50 },
  { name: 'Iron/Folate Tabs', unit: 'tabs', currentLevel: 150, reorderLevel: 30 },
  { name: 'MUAC Tapes', unit: 'tapes', currentLevel: 5, reorderLevel: 10 },
  { name: 'Weighing Scale', unit: 'units', currentLevel: 2, reorderLevel: 1 },
];

const EMPTY_SUPPLY_FORM = { name: '', unit: '', currentLevel: '', reorderLevel: '' };

// Worklist tab → screening-status predicate. The "At Risk" tab folds in the
// 'Underweight' status the same way the KPI/stat count does, so the tab count
// and the filtered rows stay in sync.
const matchesTab = (status: string, tab: string): boolean => {
  if (tab === 'all') return true;
  if (tab === 'sam') return status === 'SAM';
  if (tab === 'mam') return status === 'MAM';
  if (tab === 'at_risk') return status === 'At Risk' || status === 'Underweight';
  if (tab === 'normal') return status === 'Normal';
  return true;
};

export default function NutritionDashboard() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const { patients } = usePatients();
  const router = useRouter();

  // Real screenings persist to the synced nutrition_screenings store; demo
  // rows fill in behind them in demo mode only.
  const { screenings: savedScreenings, add: addScreening, update: updateScreening } = useNutritionScreenings();
  const [showForm, setShowForm] = useState(false);
  // Which stat panel (header toggles) occupies the center instead of the
  // screenings list; null = normal queue view.
  const [centerPanel, setCenterPanel] = useState<'classification' | 'supplies' | null>(null);
  const togglePanel = (key: 'classification' | 'supplies') =>
    setCenterPanel(prev => (prev === key ? null : key));
  const [form, setForm] = useState(EMPTY_FORM);
  // Which registered patient (if any) this screening is for. Screenings can
  // legitimately precede registration, so this stays optional — but when a
  // match exists, linking it is what lets a SAM/MAM classification reach the
  // chart and raise an order or referral instead of going nowhere.
  const [screeningPatientId, setScreeningPatientId] = useState('');
  const [formError, setFormError] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [queueSearch, setQueueSearch] = useState('');

  // Deep link: the patient chart's "Clinical forms" drawer opens a nutrition
  // screening for a specific patient via ?patientId=. The link existed but
  // nothing read the param, so the screening form opened blank and the link
  // between the classification and that patient's chart was lost. Waits for
  // `patients` to load (retries via the dep array) and fires once.
  const nutritionPatientParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || nutritionPatientParamRef.current || !patients.length) return;
    const params = new URLSearchParams(window.location.search);
    const patientId = params.get('patientId');
    if (!patientId) return;
    const match = patients.find(p => p._id === patientId);
    if (!match) return;
    nutritionPatientParamRef.current = true;
    setScreeningPatientId(match._id);
    setForm(f => ({ ...f, name: patientFullName(match), sex: match.gender === 'Male' ? 'M' : 'F' }));
    setShowForm(true);
    params.delete('patientId');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [patients]);

  const screenings = useMemo<Screening[]>(
    () => [
      ...savedScreenings.map(s => ({
        id: s._id,
        name: s.patientName,
        age: s.age,
        sex: s.sex,
        muac: s.muac,
        weight: s.weightKg ?? 0,
        height: s.heightCm ?? 0,
        edema: s.edema,
        status: s.status,
        date: s.screeningDate,
        createdAt: s.createdAt,
        screenedBy: s.screenedByName,
        patientId: s.patientId,
        notes: s.notes,
        followUpAction: s.followUpAction,
        persistable: true,
      })),
      ...(IS_DEMO
        ? SAMPLE_SCREENINGS.map(s => ({ ...s, persistable: false as const }))
        : []),
    ],
    [savedScreenings],
  );
  // Supplies now persist to the synced nutrition_supply store (real +/-
  // receipt and consumption, not a useState list lost on reload). Status
  // re-derives from each item's reorderLevel.
  const { items: supplyDocs, create: createSupply, adjust: adjustSupplyLevel } =
    useNutritionSupplies({ demoSeed: IS_DEMO ? DEMO_SUPPLY_SEED : undefined });
  const [showSupplyForm, setShowSupplyForm] = useState(false);
  const [supplyForm, setSupplyForm] = useState(EMPTY_SUPPLY_FORM);
  const [supplyFormError, setSupplyFormError] = useState('');

  const supplies = useMemo(
    () =>
      supplyDocs.map(item => ({
        id: item._id,
        name: item.name,
        unit: item.unit,
        stock: item.currentLevel,
        threshold: item.reorderLevel,
        status: classifySupplyStatus(item),
      })),
    [supplyDocs],
  );

  const adjustSupply = (id: string, delta: number) => {
    adjustSupplyLevel(id, delta, { id: currentUser?._id, name: currentUser?.name })
      .catch(err => {
        console.error('Failed to adjust supply level', err);
      });
  };

  const submitSupplyItem = async () => {
    const currentLevel = parseFloat(supplyForm.currentLevel);
    const reorderLevel = parseFloat(supplyForm.reorderLevel);
    if (!supplyForm.name.trim() || !supplyForm.unit.trim()) {
      setSupplyFormError(t('nutrition.supplyFormErrorRequired'));
      return;
    }
    if (!Number.isFinite(currentLevel) || currentLevel < 0) {
      setSupplyFormError(t('nutrition.supplyFormErrorLevel'));
      return;
    }
    try {
      await createSupply({
        name: supplyForm.name.trim(),
        unit: supplyForm.unit.trim(),
        currentLevel,
        reorderLevel: Number.isFinite(reorderLevel) ? Math.max(0, reorderLevel) : 0,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
        createdBy: currentUser?._id,
      });
      setSupplyForm(EMPTY_SUPPLY_FORM);
      setSupplyFormError('');
      setShowSupplyForm(false);
    } catch (err) {
      setSupplyFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitScreening = async () => {
    const muac = parseFloat(form.muac);
    const weight = parseFloat(form.weight);
    const height = parseFloat(form.height);
    if (!form.name.trim() || !form.age.trim()) { setFormError(t('nutrition.formErrorNameAge')); return; }
    if (!Number.isFinite(muac) || muac <= 0 || muac > 40) { setFormError(t('nutrition.formErrorMuac')); return; }
    try {
      await addScreening({
        patientId: screeningPatientId || undefined,
        patientName: form.name.trim(),
        age: form.isAnc && !form.age.toUpperCase().includes('ANC') ? `${form.age.trim()} ANC` : form.age.trim(),
        sex: form.isAnc ? 'F' : form.sex,
        muac,
        weightKg: Number.isFinite(weight) ? weight : undefined,
        heightCm: Number.isFinite(height) ? height : undefined,
        edema: form.edema,
        isAnc: form.isAnc,
        notes: form.notes.trim() || undefined,
        screenedById: currentUser?._id,
        screenedByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
      });
      setForm(EMPTY_FORM);
      setScreeningPatientId('');
      setFormError('');
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const markFollowedUp = async (s: Screening) => {
    if (!s.persistable) return;
    await updateScreening(s.id, { followUpAction: 'followed_up' });
  };

  const referScreening = async (s: Screening) => {
    if (s.persistable) {
      await updateScreening(s.id, { followUpAction: 'referred' });
    }
    router.push(`/referrals?patient=${encodeURIComponent(s.name)}`);
  };

  const startTreatment = async (s: Screening) => {
    if (s.persistable) {
      await updateScreening(s.id, { followUpAction: 'treatment_started' });
    }
    // Nutritionists are not on /consultation (RoleGuard). Open the patient
    // chart — or the registry — so treatment planning stays on allowed routes.
    if (s.patientId) {
      router.push(`/patients/${encodeURIComponent(s.patientId)}`);
      return;
    }
    router.push('/patients');
  };

  const followUpLabel = (action?: NutritionFollowUpAction) => {
    if (action === 'followed_up') return t('nutrition.followedUp');
    if (action === 'referred') return t('nutrition.referred');
    if (action === 'treatment_started') return t('nutrition.treatmentStarted');
    if (action === 'needed') return t('nutrition.followUpNeeded');
    return undefined;
  };

  const stats = useMemo(() => {
    return {
      total: screenings.length,
      sam: screenings.filter(s => s.status === 'SAM').length,
      mam: screenings.filter(s => s.status === 'MAM').length,
      atRisk: screenings.filter(s => s.status === 'At Risk' || s.status === 'Underweight').length,
      normal: screenings.filter(s => s.status === 'Normal').length,
      children: screenings.filter(s => !s.age.includes('ANC')).length,
      anc: screenings.filter(s => s.age.includes('ANC')).length,
      criticalSupply: supplies.filter(s => s.status === 'critical').length,
    };
  }, [screenings, supplies]);

  const getStatusColor = (status: string) => {
    if (status === 'SAM') return 'var(--color-danger)';
    if (status === 'MAM') return 'var(--color-warning)';
    if (status === 'At Risk' || status === 'Underweight') return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  // Worklist rows: apply the active status tab, then the free-text search over
  // name / age / status. Same shape as radiology's `filtered` memo.
  const filteredScreenings = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return screenings.filter(s => {
      if (!matchesTab(s.status, filterStatus)) return false;
      if (!q) return true;
      return [s.name, s.age, s.status].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [screenings, filterStatus, queueSearch]);

  const dateLabel = formatDateTitle(toIsoDate(new Date()));

  // Per-screening detail: edema, notes, and follow-up actions for flagged cases.
  const renderScreeningDetail = (s: Screening) => {
    const needsFollowUp = s.status !== 'Normal' && (!s.followUpAction || s.followUpAction === 'needed');
    return (
      <div className="ehr-visit-pop ehr-visit-pop--inline">
        <div className="ehr-visit-pop-body">
          <div className="ehr-visit-pop-row">
            <span className="ehr-visit-pop-label">{t('nutrition.colEdema')}</span>
            <div>
              {s.edema
                ? <strong style={{ color: 'var(--color-danger)' }}>{t('nutrition.edemaYes')}</strong>
                : <p>{t('nutrition.edemaNo')}</p>}
            </div>
          </div>
          <div className="ehr-visit-pop-row">
            <span className="ehr-visit-pop-label">{t('nutrition.notesLabel')}</span>
            <div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{s.notes?.trim() || t('nutrition.noNotes')}</p>
            </div>
          </div>
          {s.persistable && s.status !== 'Normal' && (
            <div className="ehr-visit-pop-row">
              <span className="ehr-visit-pop-label">{t('nutrition.followUpNeeded')}</span>
              <div className="flex flex-wrap gap-2">
                {needsFollowUp ? (
                  <>
                    <button
                      type="button"
                      onClick={() => markFollowedUp(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold"
                      style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
                    >
                      <CheckCircle2 className="w-3 h-3" /> {t('nutrition.markFollowedUp')}
                    </button>
                    <button
                      type="button"
                      onClick={() => referScreening(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold"
                      style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
                    >
                      <ArrowRightLeft className="w-3 h-3" /> {t('nutrition.refer')}
                    </button>
                    <button
                      type="button"
                      onClick={() => startTreatment(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold"
                      style={{ background: ACCENT, color: '#fff', border: 'none' }}
                    >
                      <HeartPulse className="w-3 h-3" /> {t('nutrition.startTreatment')}
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--color-success)' }}>
                    {followUpLabel(s.followUpAction)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!currentUser) return null;

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {IS_DEMO && <DemoModeBanner />}

      <EhrCareDashboard
        title={t('nutrition.title')}
        greetingName={currentUser?.name}
        dateLabel={dateLabel}
        tabs={[]}
        activeTab={filterStatus}
        onTabChange={setFilterStatus}
        centerSubtitle={t('nutrition.totalCount', { count: stats.total })}
        searchValue={queueSearch}
        searchPlaceholder={t('topbar.searchPlaceholder')}
        onSearchChange={setQueueSearch}
        // A screening stays on the worklist regardless of which calendar day
        // is selected — a carried-over SAM/MAM case must not disappear while
        // the filter chip counts (which are not date-scoped) still show it.
        filterRowsByDate={false}
        filters={[
          { label: t('nutrition.kpiScreenings'), value: stats.total, active: filterStatus === 'all', onClick: () => setFilterStatus('all') },
          { label: t('nutrition.kpiSamCases'), value: stats.sam, active: filterStatus === 'sam', onClick: () => setFilterStatus(filterStatus === 'sam' ? 'all' : 'sam') },
          { label: t('nutrition.kpiMamCases'), value: stats.mam, active: filterStatus === 'mam', onClick: () => setFilterStatus(filterStatus === 'mam' ? 'all' : 'mam') },
          { label: t('nutrition.kpiAtRisk'), value: stats.atRisk, active: filterStatus === 'at_risk', onClick: () => setFilterStatus(filterStatus === 'at_risk' ? 'all' : 'at_risk') },
          { label: t('nutrition.kpiNormal'), value: stats.normal, active: filterStatus === 'normal', onClick: () => setFilterStatus(filterStatus === 'normal' ? 'all' : 'normal') },
        ]}
        actions={[
          {
            label: t('nutrition.newScreening'),
            icon: Plus,
            onClick: () => { setShowForm(true); setFormError(''); },
            tone: 'primary',
          },
          { label: t('nutrition.classification'), icon: BarChart3, onClick: () => togglePanel('classification'), active: centerPanel === 'classification', tone: centerPanel === 'classification' ? 'primary' : 'neutral' },
          { label: t('nutrition.supplies'), icon: Utensils, onClick: () => togglePanel('supplies'), active: centerPanel === 'supplies', tone: centerPanel === 'supplies' ? 'primary' : 'neutral' },
        ]}
        hideRowList={centerPanel !== null}
        // "Normal" already matches the default done→series1 split; every
        // flagged classification (SAM/MAM/At Risk/Underweight) stays open.
        chartSeriesNames={['Flagged', 'Normal']}
        rows={filteredScreenings.map((s): EhrCareDashboardRow => {
          const time = formatTime(s.createdAt);
          return {
            id: s.id,
            title: s.name,
            patientId: s.patientId,
            subtitle: `${s.age} · ${s.sex}`,
            compactMeta: s.date,
            date: s.date,
            time,
            timeSecondary: s.date,
            careTeam: s.screenedBy,
            careTeamLabel: 'Screened by',
            location: `${s.muac} cm MUAC`,
            locationSecondary: `${s.weight} kg · ${s.height} cm`,
            status: s.status,
            statusLabel: s.status,
            statusSecondary: s.status === 'Normal'
              ? 'Within range'
              : (followUpLabel(s.followUpAction) || t('nutrition.followUpNeeded')),
            statusTone: s.status === 'SAM' ? 'danger'
              : s.status === 'MAM' ? 'warning'
              : (s.status === 'At Risk' || s.status === 'Underweight') ? 'warning'
              : 'done',
            // SAM/MAM/At Risk IS this screen's whole point — a same-day visit
            // must not paint over the classification with the appointment
            // ladder. The shared shell still surfaces the visit status on the
            // line under the pill when one exists.
            lockStatus: true,
            popupDetail: renderScreeningDetail(s),
          };
        })}
        metrics={[
          { label: t('nutrition.kpiChildrenUnder5'), value: stats.children },
          { label: t('nutrition.kpiAncMothers'), value: stats.anc },
          { label: t('nutrition.kpiSamCases'), value: stats.sam, tone: stats.sam > 0 ? 'danger' : 'success', onClick: () => setFilterStatus('sam') },
          { label: t('nutrition.kpiSupplyAlerts'), value: stats.criticalSupply, tone: stats.criticalSupply > 0 ? 'danger' : 'success' },
        ]}
        metricsTitle={t('nutrition.title')}
        emptyTitle={t('nutrition.noScreenings')}
      >
          {/* Stat panels — opened from the header toggles; the active one
              replaces the screenings list and occupies the whole center. */}
          {centerPanel === 'classification' && (
            <div className="dash-card">
              <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <BarChart3 className="w-4 h-4" style={{ color: ACCENT }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nutrition.classification')}</span>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: t('nutrition.classSam'), count: stats.sam, color: 'var(--color-danger)', desc: t('nutrition.classSamDesc') },
                  { label: t('nutrition.classMam'), count: stats.mam, color: 'var(--color-warning)', desc: t('nutrition.classMamDesc') },
                  { label: t('nutrition.classAtRisk'), count: stats.atRisk, color: 'var(--color-warning)', desc: t('nutrition.classAtRiskDesc') },
                  { label: t('nutrition.classNormal'), count: stats.normal, color: 'var(--color-success)', desc: t('nutrition.classNormalDesc') },
                ].map(item => {
                  const pct = stats.total > 0 ? Math.round((item.count / stats.total) * 100) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between mb-1">
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                        <span className="text-[11px] font-bold" style={{ color: item.color }}>{item.count} ({pct}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-medium)' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: item.color }} />
                      </div>
                      <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {centerPanel === 'supplies' && (
            <div className="dash-card">
              <div className="flex items-center justify-between mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <div className="flex items-center gap-2">
                  <Utensils className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nutrition.supplies')}</span>
                </div>
                <button
                  onClick={() => { setShowSupplyForm(v => !v); setSupplyFormError(''); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold"
                  style={{ background: showSupplyForm ? 'var(--overlay-subtle)' : ACCENT, color: showSupplyForm ? 'var(--text-secondary)' : '#fff', border: '1px solid var(--border-medium)', cursor: 'pointer' }}
                >
                  {showSupplyForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                  {showSupplyForm ? t('nutrition.formCancel') : t('nutrition.addSupplyItem')}
                </button>
              </div>

              {showSupplyForm && (
                <div className="px-3 pb-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={supplyForm.name}
                      onChange={e => setSupplyForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={t('nutrition.supplyFormName')}
                      className="px-2 py-1.5 rounded-md text-xs col-span-2"
                      style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                    />
                    <input
                      value={supplyForm.unit}
                      onChange={e => setSupplyForm(f => ({ ...f, unit: e.target.value }))}
                      placeholder={t('nutrition.supplyFormUnit')}
                      className="px-2 py-1.5 rounded-md text-xs"
                      style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                    />
                    <input
                      type="number" min="0" step="1"
                      value={supplyForm.currentLevel}
                      onChange={e => setSupplyForm(f => ({ ...f, currentLevel: e.target.value }))}
                      placeholder={t('nutrition.supplyFormCurrentLevel')}
                      className="px-2 py-1.5 rounded-md text-xs"
                      style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                    />
                    <input
                      type="number" min="0" step="1"
                      value={supplyForm.reorderLevel}
                      onChange={e => setSupplyForm(f => ({ ...f, reorderLevel: e.target.value }))}
                      placeholder={t('nutrition.supplyFormReorderLevel')}
                      className="px-2 py-1.5 rounded-md text-xs col-span-2"
                      style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  {supplyFormError && (
                    <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--color-danger)' }}>{supplyFormError}</p>
                  )}
                  <button
                    onClick={submitSupplyItem}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold mt-2"
                    style={{ background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    <CheckCircle2 className="w-3 h-3" /> {t('nutrition.supplyFormSave')}
                  </button>
                </div>
              )}

              <div className="p-3 space-y-1">
                {supplies.length === 0 && (
                  <p
                    className="text-xs text-center"
                    style={{ color: 'var(--text-muted)', padding: '16px 8px' }}
                  >
                    {t('nutrition.noSupplies')}
                  </p>
                )}
                {supplies.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2 px-2 rounded"
                    style={{
                      borderBottom: '1px solid var(--border-light)',
                      background: item.status === 'critical' ? 'color-mix(in srgb, var(--color-danger) 8%, transparent)'
                        : item.status === 'low' ? 'color-mix(in srgb, var(--color-warning) 8%, transparent)'
                        : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {item.status === 'critical' ? <AlertTriangle className="w-3 h-3" style={{ color: 'var(--color-danger)' }} /> :
                       item.status === 'low' ? <TrendingDown className="w-3 h-3" style={{ color: 'var(--color-warning)' }} /> :
                       <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--color-success)' }} />}
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => adjustSupply(item.id, -1)}
                        aria-label={`Decrease ${item.name}`}
                        className="flex items-center justify-center rounded"
                        style={{ width: 18, height: 18, background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}
                      >−</button>
                      <span className="text-xs font-bold" style={{
                        color: item.status === 'critical' ? 'var(--color-danger)' : item.status === 'low' ? 'var(--color-warning)' : 'var(--text-primary)',
                        minWidth: 64, textAlign: 'center',
                      }}>{item.stock} {item.unit}</span>
                      <button
                        onClick={() => adjustSupply(item.id, 1)}
                        aria-label={`Increase ${item.name}`}
                        className="flex items-center justify-center rounded"
                        style={{ width: 18, height: 18, background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
      </EhrCareDashboard>

      {showForm && (
        <Modal
          onClose={() => { setShowForm(false); setFormError(''); }}
          width={640}
          align="top"
          labelledBy="nutrition-screening-title"
        >
          <div className="p-5" style={{ background: 'var(--bg-card-solid)', borderRadius: 'var(--card-radius)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 id="nutrition-screening-title" className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                {t('nutrition.newScreening')}
              </h2>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(''); }}
                aria-label={t('nutrition.formCancel')}
                className="p-1.5 rounded-lg"
                style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-3">
              <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>
                Patient chart (optional)
              </label>
              <LabOrderPatientPicker
                patients={patients}
                selectedId={screeningPatientId}
                onSelect={(patientId) => {
                  setScreeningPatientId(patientId);
                  const patient = patients.find(p => p._id === patientId);
                  if (patient) {
                    setForm(f => ({ ...f, name: patientFullName(patient), sex: patient.gender === 'Male' ? 'M' : 'F' }));
                  }
                }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nutrition.formName')}</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                  className="w-full px-3 py-2 rounded-md text-xs"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nutrition.formAge')}</label>
                <input
                  value={form.age}
                  onChange={e => setForm(f => ({ ...f, age: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-xs"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nutrition.formSex')}</label>
                <Select
                  value={form.isAnc ? 'F' : form.sex}
                  disabled={form.isAnc}
                  onChange={e => setForm(f => ({ ...f, sex: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-xs"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                >
                  <option value="F">F</option>
                  <option value="M">M</option>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nutrition.formMuac')}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.muac}
                  onChange={e => setForm(f => ({ ...f, muac: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-xs"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nutrition.formWeight')}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.weight}
                  onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-xs"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nutrition.formHeight')}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.height}
                  onChange={e => setForm(f => ({ ...f, height: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-xs"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nutrition.formNotes')}</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                placeholder={t('nutrition.formNotesPlaceholder')}
                className="w-full px-3 py-2 rounded-md text-xs"
                style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-3">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={form.edema} onChange={e => setForm(f => ({ ...f, edema: e.target.checked }))} />
                {t('nutrition.formEdema')}
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={form.isAnc} onChange={e => setForm(f => ({ ...f, isAnc: e.target.checked }))} />
                {t('nutrition.formAnc')}
              </label>
              {parseFloat(form.muac) > 0 && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: `${getStatusColor(classifyScreening(parseFloat(form.muac), form.edema, form.isAnc))}15`,
                    color: getStatusColor(classifyScreening(parseFloat(form.muac), form.edema, form.isAnc)),
                  }}
                >
                  {t('nutrition.formClassification')}: {classifyScreening(parseFloat(form.muac), form.edema, form.isAnc)}
                </span>
              )}
            </div>

            {formError && (
              <p className="text-xs mt-2 font-semibold" style={{ color: 'var(--color-danger)' }}>{formError}</p>
            )}

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(''); }}
                className="px-4 py-2 rounded-md text-xs font-semibold"
                style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
              >
                {t('nutrition.formCancel')}
              </button>
              <button
                type="button"
                onClick={submitScreening}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold"
                style={{ background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                <CheckCircle2 className="w-3 h-3" /> {t('nutrition.formSave')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
