'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { usePatients } from '@/lib/hooks/usePatients';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { toIsoDate } from '@/lib/date-utils';
import Modal from '@/components/Modal';
import type { LabResultDoc } from '@/lib/db-types';
import {
  Microscope,
  Loader2,
  X, Save, Table,
} from '@/components/icons/lucide';
import PatientName from '@/components/PatientName';
import Select from '@/components/Select';
import { formatClockTime } from '@/lib/format-utils';

const ACCENT = 'var(--accent-primary)';

// ===== Reference Ranges for Auto-Flagging =====
interface ReferenceRange {
  test: string;
  unit: string;
  normalMin?: number;
  normalMax?: number;
  criticalLow?: number;
  criticalHigh?: number;
  qualitative?: string[]; // For qualitative tests like Malaria RDT, HIV
  referenceStr: string;
}

const REFERENCE_RANGES: ReferenceRange[] = [
  { test: 'Hemoglobin', unit: 'g/dL', normalMin: 12, normalMax: 17, criticalLow: 7, criticalHigh: 20, referenceStr: '12-17 g/dL' },
  { test: 'WBC', unit: '/μL', normalMin: 4000, normalMax: 11000, criticalLow: 2000, criticalHigh: 30000, referenceStr: '4000-11000 /μL' },
  { test: 'Platelets', unit: '/μL', normalMin: 150000, normalMax: 400000, criticalLow: 50000, referenceStr: '150000-400000 /μL' },
  { test: 'Blood Glucose', unit: 'mg/dL', normalMin: 70, normalMax: 140, criticalLow: 40, criticalHigh: 400, referenceStr: '70-140 mg/dL' },
  { test: 'Creatinine', unit: 'mg/dL', normalMin: 0.6, normalMax: 1.2, criticalHigh: 5, referenceStr: '0.6-1.2 mg/dL' },
  { test: 'Malaria RDT', unit: '', qualitative: ['Positive', 'Negative'], referenceStr: 'Negative' },
  { test: 'HIV', unit: '', qualitative: ['Reactive', 'Non-reactive'], referenceStr: 'Non-reactive' },
];

function getRefRange(testName: string): ReferenceRange | undefined {
  return REFERENCE_RANGES.find(r => testName.toLowerCase().includes(r.test.toLowerCase()));
}

function flagResult(testName: string, value: string): { flag: 'NORMAL' | 'ABNORMAL' | 'CRITICAL'; abnormal: boolean; critical: boolean } {
  const ref = getRefRange(testName);
  if (!ref) return { flag: 'NORMAL', abnormal: false, critical: false };

  // Qualitative tests
  if (ref.qualitative) {
    const normalValues = ['Negative', 'Non-reactive'];
    const isNormal = normalValues.some(n => value.toLowerCase() === n.toLowerCase());
    return isNormal
      ? { flag: 'NORMAL', abnormal: false, critical: false }
      : { flag: 'ABNORMAL', abnormal: true, critical: false };
  }

  // Numeric tests
  const num = parseFloat(value);
  if (isNaN(num)) return { flag: 'NORMAL', abnormal: false, critical: false };

  // Check critical first
  if (ref.criticalLow !== undefined && num < ref.criticalLow) return { flag: 'CRITICAL', abnormal: true, critical: true };
  if (ref.criticalHigh !== undefined && num > ref.criticalHigh) return { flag: 'CRITICAL', abnormal: true, critical: true };

  // Check abnormal
  if (ref.normalMin !== undefined && num < ref.normalMin) return { flag: 'ABNORMAL', abnormal: true, critical: false };
  if (ref.normalMax !== undefined && num > ref.normalMax) return { flag: 'ABNORMAL', abnormal: true, critical: false };

  return { flag: 'NORMAL', abnormal: false, critical: false };
}

const FLAG_COLORS = {
  NORMAL: { bg: 'rgba(79, 199, 155,0.12)', color: 'var(--color-success)', border: 'rgba(79, 199, 155,0.25)' },
  ABNORMAL: { bg: 'rgba(255, 210, 166,0.12)', color: 'var(--color-warning)', border: 'rgba(255, 210, 166,0.25)' },
  CRITICAL: { bg: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger)', border: 'rgba(224, 49, 39,0.25)' },
};

function labStatusLabel(status: 'pending' | 'in_progress' | 'completed'): string {
  if (status === 'completed') return 'Complete';
  if (status === 'in_progress') return 'Processing';
  return 'Pending';
}

// Juba is UTC+3 — a result filed in the first three hours of the local day has
// a UTC instant that still reads as the previous day. `completedAt`/`orderedAt`
// stay full ISO instants (correct, and how the SLA math elsewhere needs them);
// only the CALENDAR DATE shown/bucketed here must be derived in local time
// (this repo's client-side convention — raw UTC slicing is for app/api only).
function localDatePart(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : toIsoDate(d);
}

// Rendered lists are capped so a long-lived, never-date-scoped queue (see
// `filterRowsByDate={false}` below) can't unbounded-render thousands of rows.
// Every tab count below is derived from the SAME capped, search-filtered array
// that actually renders, so the badge can never claim more than what's on
// screen — and `centerSubtitle` spells out "Showing N of M" whenever the cap
// actually trims something, so a bigger backlog is never silently invisible.
const LAB_QUEUE_ROW_CAP = 40;

type CompletedDiseaseRow = {
  id: string;
  lab: LabResultDoc;
  disease: string;
  detail: string;
  severity: 'normal' | 'abnormal' | 'critical';
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function diseasesForCompletedLab(lab: LabResultDoc): Omit<CompletedDiseaseRow, 'id' | 'lab'>[] {
  if (lab.status !== 'completed') return [];
  const text = `${lab.testName} ${lab.result} ${lab.clinicalNotes || ''}`.toLowerCase();
  const result = (lab.result || '').toLowerCase();
  const diseases: string[] = [];

  if (/malaria|p\.?\s*falciparum|plasmodium/.test(text) && /positive|detected|falciparum/.test(result)) diseases.push('Malaria');
  if (/\bhiv\b|aids/.test(text) && /positive|reactive|detected/.test(result) && !/non[-\s]?reactive|negative/.test(result)) diseases.push('HIV Disease');
  if (/sputum|afb|tuberculosis|\btb\b/.test(text) && /positive|detected|acid-fast/.test(result)) diseases.push('Tuberculosis');
  if (/glucose|diabetes|hba1c/.test(text) && lab.abnormal) diseases.push('Diabetes Mellitus');
  if (/hemoglobin|haemoglobin|\bhb\b|full blood count|cbc|fbc/.test(text) && /hb\s*[0-9]|hemoglobin|haemoglobin/.test(text) && lab.abnormal) diseases.push('Anaemia');
  if (/wbc|white blood|leucocyt|leukocyt|full blood count|cbc|fbc/.test(text) && /wbc|leucocyt|leukocyt/.test(text) && lab.abnormal) diseases.push('Infection / Leukocytosis');
  if (/creatinine|bun|renal|kidney/.test(text) && lab.abnormal) diseases.push('Renal Impairment');
  if (/urinalysis|urine|leucocytes|leukocytes|nitrite/.test(text) && /leucocytes|leukocytes|nitrite|bacteria/.test(text) && lab.abnormal) diseases.push('Urinary Tract Infection');
  if (/protein/.test(text) && /urine|urinalysis|proteinuria/.test(text) && lab.abnormal) diseases.push('Proteinuria');
  if (/liver|alt|ast|bilirubin|hepatitis/.test(text) && lab.abnormal) diseases.push('Liver Disease');

  return unique(diseases.length > 0 ? diseases : (lab.abnormal || lab.critical ? [`${lab.testName} Abnormality`] : []))
    .map(disease => ({
      disease,
      detail: `${lab.testName}${lab.result ? `: ${lab.result}` : ''}`,
      severity: lab.critical ? 'critical' : lab.abnormal ? 'abnormal' : 'normal',
    }));
}

// Shared between the tab counts and the rendered rows (see LAB_QUEUE_ROW_CAP
// above) so a count can never promise a row that the search box has actually
// excluded.
function matchesLabQueueSearch(order: Pick<LabResultDoc, 'patientName' | 'testName' | 'specimen' | 'orderedBy'>, query: string): boolean {
  if (!query) return true;
  return (
    (order.patientName || '').toLowerCase().includes(query) ||
    (order.testName || '').toLowerCase().includes(query) ||
    (order.specimen || '').toLowerCase().includes(query) ||
    (order.orderedBy || '').toLowerCase().includes(query)
  );
}

function matchesLabDiseaseSearch(row: CompletedDiseaseRow, query: string): boolean {
  if (!query) return true;
  return (
    row.disease.toLowerCase().includes(query) ||
    row.lab.patientName.toLowerCase().includes(query) ||
    row.lab.testName.toLowerCase().includes(query) ||
    row.detail.toLowerCase().includes(query)
  );
}

interface BatchEntry {
  orderId: string;
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  specimen: string;
  resultValue: string;
  flag: 'NORMAL' | 'ABNORMAL' | 'CRITICAL' | '';
}

export default function LabDashboardPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { results: allResults, loading, update } = useLabResults();
  const { patients } = usePatients();
  const patientById = useMemo(() => new Map(patients.map(patient => [patient._id, patient])), [patients]);
  const patientByName = useMemo(() => new Map(
    patients.map(patient => [
      `${patient.firstName} ${patient.middleName || ''} ${patient.surname}`.replace(/\s+/g, ' ').trim().toLowerCase(),
      patient,
    ]),
  ), [patients]);
  const patientForLab = (patientId?: string, patientName?: string) =>
    (patientId ? patientById.get(patientId) : undefined)
    || (patientName ? patientByName.get(patientName.trim().toLowerCase()) : undefined);
  // Imaging orders (specimen 'Imaging') belong to the radiology work queue —
  // keep the lab bench focused on specimen-based investigations.
  const results = useMemo(() => allResults.filter(r => !isImagingStudy(r)), [allResults]);
  const dateLabel = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit' }).format(new Date()), []);
  // Work-queue status filter (shell tabs) + inline search bound to the shell's
  // left rail. Station work queues use their own vocabulary: Queued =
  // ordered/pending, In Progress = on the bench, Completed = resulted.
  const [queueFilter, setQueueFilter] = useState<'scheduled' | 'in_office' | 'finished'>('scheduled');
  const [queueSearch, setQueueSearch] = useState('');

  // Feature 1: Result Entry Modal
  const [showResultModal, setShowResultModal] = useState(false);

  // Feature 3: Batch Entry
  const [batchTestType, setBatchTestType] = useState('');
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);

  // --- Categorized results ---
  // Every pending/in-progress order regardless of search or the render cap —
  // feeds batch entry's test-type picker, which must offer every order on the
  // bench, not just the ones the current queue search happens to match.
  const allPendingOrders = useMemo(() => results.filter(r => r.status === 'pending' || r.status === 'in_progress'), [results]);
  // Day-activity rail: the row list is one tab's lane, capped at
  // LAB_QUEUE_ROW_CAP, so charting it showed a single day's slice of one lane.
  // Built from every order on the bench instead — awaiting ones plotted when
  // they were ordered, resulted ones when they were resulted.
  const chartItems = useMemo<DayStatsItem[]>(() => results.map(order => {
    const resulted = order.status === 'completed';
    const at = (resulted && order.completedAt) || order.orderedAt || order.completedAt;
    return {
      date: at ? localDatePart(at) : undefined,
      time: at ? formatClockTime(at) : undefined,
      series: (resulted ? 1 : 0) as 0 | 1,
    };
  }), [results]);
  const completedDiseaseRows = useMemo<CompletedDiseaseRow[]>(() => {
    return results
      .flatMap(lab => diseasesForCompletedLab(lab).map((disease, index) => ({
        ...disease,
        id: `${lab._id}-${index}`,
        lab,
      })))
      .sort((a, b) => a.disease.localeCompare(b.disease) || a.lab.patientName.localeCompare(b.lab.patientName));
  }, [results]);

  const queueQuery = queueSearch.trim().toLowerCase();

  // Search-filtered matches per lane, BEFORE the LAB_QUEUE_ROW_CAP render cap.
  // Every tab count below is `Math.min(matches.length, LAB_QUEUE_ROW_CAP)` —
  // exactly the number of rows that lane would render if selected — so a tab
  // count can never promise a row that the search box or the cap has actually
  // excluded.
  const scheduledMatches = useMemo(
    () => results.filter(r => r.status === 'pending' && matchesLabQueueSearch(r, queueQuery)),
    [results, queueQuery],
  );
  const inOfficeMatches = useMemo(
    () => results.filter(r => r.status === 'in_progress' && matchesLabQueueSearch(r, queueQuery)),
    [results, queueQuery],
  );
  const finishedMatches = useMemo(
    () => completedDiseaseRows.filter(row => matchesLabDiseaseSearch(row, queueQuery)),
    [completedDiseaseRows, queueQuery],
  );

  // Work queue rendered by the shared shell: filtered by the selected status
  // chip and the inline search query, then capped at LAB_QUEUE_ROW_CAP.
  // Pending / in-progress orders sort first so the most actionable work is at
  // the top of the list.
  const visibleQueue = useMemo(
    () => (queueFilter === 'in_office' ? inOfficeMatches : scheduledMatches).slice(0, LAB_QUEUE_ROW_CAP),
    [queueFilter, scheduledMatches, inOfficeMatches],
  );
  const visibleCompletedDiseaseRows = useMemo(
    () => finishedMatches.slice(0, LAB_QUEUE_ROW_CAP),
    [finishedMatches],
  );

  // The active tab's own "Showing N of M" affordance: undefined when no cap is
  // in effect, which now leaves the bar with no subtitle at all. Nothing is
  // ever hidden silently — when the cap trims a lane, the center panel says
  // so, and that is the only thing this line is for.
  const activeTabMatchTotal =
    queueFilter === 'finished' ? finishedMatches.length :
    queueFilter === 'in_office' ? inOfficeMatches.length :
    scheduledMatches.length;
  const activeTabShownCount =
    queueFilter === 'finished' ? visibleCompletedDiseaseRows.length : visibleQueue.length;
  const centerSubtitle = activeTabMatchTotal > activeTabShownCount
    ? `Showing ${activeTabShownCount} of ${activeTabMatchTotal}`
    : undefined;
  // Unique test types for batch mode
  const pendingTestTypes = useMemo(() => {
    const types = new Set(allPendingOrders.map(o => o.testName));
    return Array.from(types).sort();
  }, [allPendingOrders]);

  // Batch mode: populate entries when test type changes
  useEffect(() => {
    if (batchTestType && true) {
      const orders = allPendingOrders.filter(o => o.testName === batchTestType);
      setBatchEntries(orders.map(o => ({
        orderId: o._id,
        patientId: o.patientId,
        patientName: o.patientName,
        hospitalNumber: o.hospitalNumber,
        specimen: o.specimen,
        resultValue: '',
        flag: '',
      })));
    }
  }, [batchTestType, allPendingOrders]);




  // --- Handlers ---

  const handleBatchSave = async () => {
    const filled = batchEntries.filter(e => e.resultValue.trim() !== '');
    if (filled.length === 0) return;
    setBatchSaving(true);
    try {
      for (const entry of filled) {
        const order = allPendingOrders.find(o => o._id === entry.orderId);
        if (!order) continue;
        const flags = flagResult(order.testName, entry.resultValue);
        const ref = getRefRange(order.testName);
        await update(order._id, {
          status: 'completed' as const,
          result: entry.resultValue,
          unit: ref?.unit || order.unit,
          referenceRange: ref?.referenceStr || order.referenceRange,
          abnormal: flags.abnormal,
          critical: flags.critical,
          completedAt: new Date().toISOString(),
        });
      }
      setBatchTestType('');
      setBatchEntries([]);
    } catch (err) {
      console.error('Failed to batch save:', err);
    } finally {
      setBatchSaving(false);
    }
  };

  // Drop a patient row from the current batch-entry draft before saving. Only
  // removes it from this in-progress batch; the order itself is untouched.
  const handleRemoveBatchEntry = (orderId: string) => {
    setBatchEntries(prev => prev.filter(e => e.orderId !== orderId));
  };

  const handleBatchEntryChange = (orderId: string, value: string) => {
    setBatchEntries(prev => prev.map(e => {
      if (e.orderId !== orderId) return e;
      const order = allPendingOrders.find(o => o._id === orderId);
      const flagRes = order && value ? flagResult(order.testName, value) : null;
      return { ...e, resultValue: value, flag: flagRes ? flagRes.flag : '' };
    }));
  };

  if (loading) {
    return (
      <main className="page-container page-enter flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: ACCENT }} />
      </main>
    );
  }

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <EhrCareDashboard
          title={t('lab.laboratory')}
          eyebrow={t('nav.lab')}
          greetingName={currentUser?.name}
          dateLabel={dateLabel}
          tabs={[
            { key: 'scheduled', label: t('workQueue.queued'), count: Math.min(scheduledMatches.length, LAB_QUEUE_ROW_CAP) },
            { key: 'in_office', label: t('workQueue.inProgress'), count: Math.min(inOfficeMatches.length, LAB_QUEUE_ROW_CAP) },
            { key: 'finished', label: t('workQueue.completed'), count: Math.min(finishedMatches.length, LAB_QUEUE_ROW_CAP) },
          ]}
          activeTab={queueFilter}
          onTabChange={(k) => setQueueFilter(k as typeof queueFilter)}
          searchValue={queueSearch}
          searchPlaceholder={t('topbar.searchPlaceholder')}
          onSearchChange={setQueueSearch}
          // A pending order or a resulted-but-not-yet-reviewed test stays on
          // the bench across days — the calendar's selected day must not hide
          // it while the tab counts (which are not date-scoped) still show it.
          filterRowsByDate={false}
          // Set only when LAB_QUEUE_ROW_CAP actually trimmed this lane, so a
          // bigger backlog is never silently invisible; otherwise no subtitle.
          centerSubtitle={centerSubtitle}
          filters={[]}
          actions={[
            // Single results are entered in the chart's bench workflow. What is
            // left here is the one thing the chart cannot do: filling in a
            // whole run of the same test in one pass.
            { label: t('lab.batchEntry'), icon: Table, onClick: () => setShowResultModal(true), tone: 'primary' },
          ]}
          // Critical/abnormal results still count as "resulted" for the day chart —
          // statusTone flags severity, not completion, so chartSeries is set
          // explicitly from order.status rather than relying on the done→series1
          // default (which would otherwise misfile a flagged result as "awaiting").
          chartSeriesNames={['Awaiting', 'Resulted']}
          chartItems={chartItems}
          rows={queueFilter === 'finished' ? visibleCompletedDiseaseRows.map((row): EhrCareDashboardRow => {
            const lab = row.lab;
            const time = lab.completedAt ? formatClockTime(lab.completedAt) : undefined;
            return {
              id: row.id,
              photoUrl: patientForLab(lab.patientId, lab.patientName)?.photoUrl,
              title: lab.patientName,
              subtitle: lab.hospitalNumber || 'ID not recorded',
              meta: `${lab.hospitalNumber || ''}${lab.orderedBy ? ` · ${t('lab.orderedBy', { name: lab.orderedBy })}` : ''}`.replace(/^ · /, ''),
              careTeam: lab.orderedBy,
              careTeamLabel: 'Ordered by',
              compactMeta: time,
              time,
              date: localDatePart(lab.completedAt || lab.orderedAt),
              timeSecondary: lab.completedAt ? localDatePart(lab.completedAt) : 'Resulted',
              status: 'completed',
              statusLabel: 'Complete',
              statusSecondary: row.severity === 'critical' ? 'Critical' : row.severity === 'abnormal' ? 'Abnormal' : 'Normal',
              statusTone: row.severity === 'critical' ? 'danger' : row.severity === 'abnormal' ? 'warning' : 'done',
              location: row.disease || lab.testName,
              locationSecondary: `${row.detail} · ${lab.specimen}${lab.accessionNumber ? ` · ${lab.accessionNumber}` : ''}`,
              chartSeries: 1,
              // A critical result is a true acuity — same RED pill the rest
              // of the app uses for "needs attention now", not free text.
              priority: row.severity === 'critical' ? 'RED' : undefined,
              // The row opens a compact dashboard preview first; its full-page
              // action enters the bench workflow for this specific order.
              patientId: lab.patientId,
              detailHref: `/patients/${encodeURIComponent(lab.patientId)}?tab=labs&focus=${encodeURIComponent(lab._id)}&returnTo=${encodeURIComponent('/dashboard/lab')}`,
              detailLabel: t('dashboard.viewPatientRecord'),
              // Complete/Abnormal/Critical IS this screen's whole point — a
              // same-day visit must not paint over a CRITICAL result's red
              // pill with the visit's own tone. The shared shell still
              // surfaces the visit status on the line under the pill.
              lockStatus: true,
            };
          }) : visibleQueue.map((order): EhrCareDashboardRow => {
            const time = order.status === 'completed'
              ? (order.completedAt ? formatClockTime(order.completedAt) : undefined)
              : (order.orderedAt ? formatClockTime(order.orderedAt) : undefined);
            return {
              id: order._id,
              photoUrl: patientForLab(order.patientId, order.patientName)?.photoUrl,
              title: order.patientName,
              subtitle: order.hospitalNumber || 'ID not recorded',
              meta: order.orderedBy ? t('lab.orderedBy', { name: order.orderedBy }) : undefined,
              careTeam: order.orderedBy,
              careTeamLabel: 'Ordered by',
              compactMeta: time,
              time,
              date: localDatePart(order.completedAt || order.orderedAt),
              timeSecondary: order.status === 'completed'
                ? (order.completedAt ? localDatePart(order.completedAt) : 'Completed')
                : (order.orderedAt ? localDatePart(order.orderedAt) : 'Ordered'),
              status: order.status,
              statusLabel: labStatusLabel(order.status),
              statusSecondary: order.critical ? 'Critical' : order.abnormal ? 'Abnormal' : order.specimen,
              statusTone: order.critical ? 'danger' : order.abnormal ? 'warning' : order.status === 'completed' ? 'done' : order.status === 'in_progress' ? 'active' : 'scheduled',
              location: order.testName,
              locationSecondary: `${order.specimen}${order.accessionNumber ? ` · ${order.accessionNumber}` : ''}`,
              chartSeries: order.status === 'completed' ? 1 : 0,
              // A critical result is a true acuity — same RED pill the rest
              // of the app uses for "needs attention now", not free text.
              priority: order.critical ? 'RED' : undefined,
              patientId: order.patientId,
              detailHref: `/patients/${encodeURIComponent(order.patientId)}?tab=labs&focus=${encodeURIComponent(order._id)}&returnTo=${encodeURIComponent('/dashboard/lab')}`,
              detailLabel: t('dashboard.viewPatientRecord'),
              // Pending/In Progress/Complete (and a CRITICAL flag) IS the
              // bench queue's whole point — a same-day visit must not paint
              // over it. The shared shell still surfaces the visit status on
              // the line under the pill.
              lockStatus: true,
            };
          })}
          metrics={[
            { label: t('lab.abnormalBadge'), value: completedDiseaseRows.filter(row => row.severity === 'abnormal').length, tone: 'warning' },
            { label: t('lab.critical'), value: completedDiseaseRows.filter(row => row.severity === 'critical').length, tone: 'danger' },
          ]}
          metricsTitle={t('lab.laboratory')}
          emptyTitle={t('lab.noPendingOrders')}
        />
      </main>

      {/* Batch result entry — a whole run of one test in a single pass. Single
          results are entered in the chart's bench workflow instead. */}
      {showResultModal && (
        <Modal
          onClose={() => { setShowResultModal(false); setBatchTestType(''); }}
          width={672}
        >
          <div className="dash-card w-full rounded-2xl overflow-hidden" style={{
            boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          }}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <div className="flex items-center gap-2">
                <Microscope className="w-4 h-4" style={{ color: ACCENT }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('lab.batchEntry')}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowResultModal(false); setBatchTestType(''); }} className="p-1 rounded-lg transition-all" style={{ color: 'var(--text-muted)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {(
                /* ===== Batch Entry Mode ===== */
                <div className="space-y-4">
                  {/* Test Type Selection */}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                      {t('lab.selectTestType')}
                    </label>
                    <Select
                      value={batchTestType}
                      onChange={e => setBatchTestType(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-[12px] outline-none transition-all"
                      style={{
                        background: 'var(--overlay-subtle)',
                        border: '1px solid var(--border-light)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value="">{t('lab.selectTestTypeOption')}</option>
                      {pendingTestTypes.map(tt => {
                        const count = allPendingOrders.filter(o => o.testName === tt).length;
                        return (
                          <option key={tt} value={tt}>{t('lab.testTypePending', { test: tt, count })}</option>
                        );
                      })}
                    </Select>
                  </div>

                  {/* Reference range for selected test */}
                  {batchTestType && (() => {
                    const ref = getRefRange(batchTestType);
                    return ref ? (
                      <div className="p-2.5 rounded-xl" style={{ background: 'rgba(33, 145, 208, 0.06)', border: '1px solid var(--accent-border)' }}>
                        <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
                          {t('lab.reference')}: {ref.referenceStr}
                          {ref.criticalLow !== undefined && ` | ${t('lab.criticalLabel')}: <${ref.criticalLow}`}
                          {ref.criticalHigh !== undefined && ` | ${t('lab.criticalLabel')}: >${ref.criticalHigh}`}
                        </p>
                      </div>
                    ) : null;
                  })()}

                  {/* Batch Table */}
                  {batchEntries.length > 0 ? (
                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
                      <div className="overflow-x-auto">
                      <table className="w-full" style={{ minWidth: 520 }}>
                        <thead className="appointment-table-head">
                          <tr style={{ background: 'var(--overlay-subtle)' }}>
                            <th className="text-start px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.patient')}</th>
                            <th className="text-start px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.specimen')}</th>
                            <th className="text-start px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.result')}</th>
                            <th className="text-center px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.flag')}</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchEntries.map((entry) => {
                            const ref = getRefRange(batchTestType);
                            return (
                              <tr key={entry.orderId} style={{ borderTop: '1px solid var(--border-light)' }}>
                                <td className="px-3 py-2">
                                  <PatientName
                                    patient={patientForLab(entry.patientId, entry.patientName)}
                                    patientId={entry.patientId}
                                    name={entry.patientName}
                                    showAvatar
                                    size={40}
                                    secondaryText={entry.hospitalNumber || 'ID not recorded'}
                                    nameClassName="text-[11px] font-medium"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{entry.specimen}</span>
                                </td>
                                <td className="px-3 py-2">
                                  {ref?.qualitative ? (
                                    <Select
                                      value={entry.resultValue}
                                      onChange={e => handleBatchEntryChange(entry.orderId, e.target.value)}
                                      className="w-full px-2 py-1 rounded-lg text-[11px] outline-none"
                                      style={{
                                        background: 'var(--overlay-subtle)',
                                        border: '1px solid var(--border-light)',
                                        color: 'var(--text-primary)',
                                      }}
                                    >
                                      <option value="">--</option>
                                      {ref.qualitative.map(v => (
                                        <option key={v} value={v}>{v}</option>
                                      ))}
                                    </Select>
                                  ) : (
                                    <input
                                      type="number"
                                      step="any"
                                      value={entry.resultValue}
                                      onChange={e => handleBatchEntryChange(entry.orderId, e.target.value)}
                                      placeholder={t('lab.valuePlaceholder')}
                                      className="w-full px-2 py-1 rounded-lg text-[11px] outline-none"
                                      style={{
                                        background: 'var(--overlay-subtle)',
                                        border: '1px solid var(--border-light)',
                                        color: 'var(--text-primary)',
                                      }}
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {entry.flag ? (
                                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{
                                      background: FLAG_COLORS[entry.flag as keyof typeof FLAG_COLORS].bg,
                                      color: FLAG_COLORS[entry.flag as keyof typeof FLAG_COLORS].color,
                                    }}>{entry.flag}</span>
                                  ) : (
                                    <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>--</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-end">
                                  <button
                                    onClick={() => handleRemoveBatchEntry(entry.orderId)}
                                    title={t('action.remove')}
                                    aria-label={t('action.remove')}
                                    className="p-1 rounded-md transition-all hover:opacity-80"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  ) : batchTestType ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Table className="w-8 h-8 mb-2" style={{ color: 'var(--text-muted)', opacity: 0.15 }} />
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('lab.noPendingForType')}</p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
              <button
                onClick={() => { setShowResultModal(false); setBatchTestType(''); }}
                className="px-4 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}
              >
                {t('action.cancel')}
              </button>

              {(
                <button
                  onClick={handleBatchSave}
                  disabled={batchEntries.filter(e => e.resultValue.trim() !== '').length === 0 || batchSaving}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40"
                  style={{
                    background: batchEntries.some(e => e.resultValue.trim()) ? ACCENT : 'var(--border-light)',
                    color: batchEntries.some(e => e.resultValue.trim()) ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {batchSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {t('lab.saveAll', { count: batchEntries.filter(e => e.resultValue.trim() !== '').length })}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
