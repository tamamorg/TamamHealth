'use client';

/**
 * The lab technician's home: the doctor's dashboard (EhrClinicalDashboard),
 * worked in bench terms.
 *
 * The lab station listed one row per test in its own console. It now works the
 * way a doctor's day does — one row per patient, the visit and vitals one click
 * away — but every column, lane, count and chart is the bench's: what is still
 * to be collected, what is on the bench, what has resulted. A test is worked in
 * the right-hand slider here, or in the chart's Lab orders workspace
 * (`?form=lab-orders`); both are the same six bench steps.
 *
 * Patients the front desk sent to this technician (`stationAssignments.lab`)
 * are on the list even before a test is ordered.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Microscope, Plus, Table, Timer } from '@/components/icons/lucide';
import EhrClinicalDashboard, {
  type WorklistPatient,
  type OutstandingItem,
  type OutstandingEntry,
} from '@/components/ehr/EhrClinicalDashboard';
import EhrPanelTitle from '@/components/ehr/EhrPanelTitle';
import { EhrPatientOrderList, withOthers } from '@/components/ehr/EhrPatientOrders';
import type { DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useNow } from '@/lib/hooks/useNow';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { patientDisplayName, patientAge, shortenPersonName } from '@/lib/patient-utils';
import { appointmentsVisibleToUser } from '@/lib/appointment-visibility';
import { localClockOf, localDayOf, toIsoDate } from '@/lib/date-utils';
import { agoLabel, durationLabel, shortDayLabel } from '@/lib/station-time';
import { effectiveOrderStatus } from '@/lib/services/lab-service';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { benchActionLabel, benchActions } from '@/components/lab/workflow/lab-workflow-types';
import LabBenchSlider from '@/components/lab/workflow/LabBenchSlider';
import LabIntakeSlider from '@/components/lab/order/LabIntakeSlider';
import type { LabResultDoc, PatientDoc } from '@/lib/db-types';

/** Opens the chart with the lab form up, on one test when `orderId` is given. */
export function labFormHref(patientId: string, orderId?: string): string {
  const focus = orderId ? `&focus=${encodeURIComponent(orderId)}` : '';
  return `/patients/${encodeURIComponent(patientId)}?form=lab-orders${focus}`;
}

export type LabBenchStage = 'collect' | 'bench' | 'resulted';

/**
 * Where one test stands on the bench. Read from the lifecycle stage: the coarse
 * status stays `pending` until processing starts, so a specimen already drawn
 * and booked in still read "To collect".
 */
export function labBenchStage(order: Pick<LabResultDoc, 'status' | 'orderStatus'>): LabBenchStage {
  const stage = effectiveOrderStatus(order);
  if (stage === 'ordered' || stage === 'rejected_needs_recollection') return 'collect';
  if (stage === 'specimen_collected' || stage === 'received_at_lab' || stage === 'in_process') return 'bench';
  return 'resulted';
}

export interface LabWorklistLabels {
  collect: string;
  bench: string;
  resulted: string;
  critical: string;
  assigned: string;
  resultedToday: string;
  tests: (count: number) => string;
  /** Translates a row's next-step labels. */
  t?: (key: string) => string;
}

export interface LabWorklistInput {
  currentUser: { _id: string; name?: string };
  patients: PatientDoc[];
  /** Every order in scope; imaging studies are the radiographer's and are ignored. */
  results: LabResultDoc[];
  labels: LabWorklistLabels;
  now?: Date;
}

export interface LabWorklistResult {
  patients: WorklistPatient[];
  outstanding: OutstandingItem[];
  activity: DayStatsItem[];
  counts: Record<LabBenchStage, number>;
  /** Median minutes from order to result, over today's results. */
  turnaroundMinutes: number | null;
  /** The longest-waiting open test, for the turnaround card. */
  oldestOpen: LabResultDoc | null;
}

const STAGE_RANK: Record<LabBenchStage, number> = { bench: 0, collect: 1, resulted: 2 };


export function assembleLabWorklist({
  currentUser, patients, results, labels, now = new Date(),
}: LabWorklistInput): LabWorklistResult {
  const today = toIsoDate(now);
  const patientById = new Map(patients.map(p => [p._id, p]));
  const tests = results.filter(r => !isImagingStudy(r));
  const open = tests
    .filter(r => r.status !== 'completed')
    .sort((a, b) => Number(b.critical) - Number(a.critical)
      || STAGE_RANK[labBenchStage(a)] - STAGE_RANK[labBenchStage(b)]
      || (a.orderedAt || '').localeCompare(b.orderedAt || ''));
  const resultedToday = tests.filter(r => r.status === 'completed' && localDayOf(r.completedAt) === today);
  const clock = (iso?: string) => (iso && localDayOf(iso) === today ? localClockOf(iso) : shortDayLabel(iso));

  const rows: WorklistPatient[] = [];
  const seen = new Set<string>();
  const row = (patientId: string, name: string, base: Partial<WorklistPatient> & { station: WorklistPatient['station'] }) => {
    seen.add(patientId);
    const doc = patientById.get(patientId);
    const assignedTo = doc?.stationAssignments?.lab;
    rows.push({
      _id: patientId,
      photoUrl: doc?.photoUrl,
      name: doc ? patientDisplayName(doc) : shortenPersonName(name),
      age: doc ? patientAge(doc) : null,
      gender: doc?.gender?.[0] || '',
      id: doc?.hospitalNumber,
      assignedDoctor: currentUser._id,
      assignedDoctorName: currentUser.name,
      ...base,
      station: base.station && {
        ...base.station,
        careTeamSecondary: assignedTo ? `${labels.assigned}: ${shortenPersonName(assignedTo.staffName)}` : '',
      },
    });
  };

  // Open work first: one row per patient, named by their most pressing test.
  for (const test of open) {
    if (!test.patientId || seen.has(test.patientId)) continue;
    const mine = open.filter(r => r.patientId === test.patientId);
    const stage = labBenchStage(test);
    row(test.patientId, test.patientName, {
      ward: withOthers(test.testName, mine.length - 1),
      division: withOthers(test.testName, mine.length - 1),
      doctor: test.orderedBy || '',
      triagePriority: mine.some(r => r.critical) ? 'RED' : 'GREEN',
      assignmentStatus: stage === 'bench' ? 'in_progress' : 'assigned',
      station: {
        timeLabel: clock(test.orderedAt),
        timeSubtext: agoLabel(test.orderedAt, now),
        context: withOthers(test.testName, mine.length - 1),
        contextSubtext: mine.length > 1 ? mine.slice(1).map(r => r.testName).join(', ') : test.specimen,
        status: stage === 'bench' ? labels.bench : labels.collect,
        statusTone: mine.some(r => r.critical) ? 'danger' : stage === 'bench' ? 'active' : 'scheduled',
        statusSubtext: mine.some(r => r.critical) ? labels.critical : mine.length > 1 ? labels.tests(mine.length) : '',
        lane: stage === 'bench' ? 'in_office' : 'scheduled',
        chartHref: labFormHref(test.patientId, test._id),
        openId: test._id,
        actions: labels.t ? benchActions(effectiveOrderStatus(test), labels.t) : undefined,
      },
    });
  }
    // Everything resulted today is under Resulted, even for a patient with other
  // tests still open: that patient has a row in each lane.
  const resultedRows = new Set<string>();
  for (const test of resultedToday) {
    if (!test.patientId || resultedRows.has(test.patientId)) continue;
    resultedRows.add(test.patientId);
    const mine = resultedToday.filter(r => r.patientId === test.patientId);
    const flagged = mine.find(r => r.critical) || mine.find(r => r.abnormal);
    row(test.patientId, test.patientName, {
      ward: withOthers(test.testName, mine.length - 1),
      division: withOthers(test.testName, mine.length - 1),
      doctor: test.orderedBy || '',
      triagePriority: mine.some(r => r.critical) ? 'RED' : 'GREEN',
      assignmentStatus: 'completed',
      station: {
        timeLabel: clock(test.completedAt),
        timeSubtext: agoLabel(test.completedAt, now),
        context: withOthers(test.testName, mine.length - 1),
        contextSubtext: flagged ? `${flagged.testName}: ${flagged.result}` : test.result,
        status: labels.resulted,
        statusTone: flagged?.critical ? 'danger' : flagged ? 'warning' : 'done',
        statusSubtext: flagged ? (flagged.critical ? labels.critical : flagged.result) : (mine.length > 1 ? labels.tests(mine.length) : test.result),
        lane: 'finished',
        rowKey: `${test.patientId}:resulted`,
        chartHref: labFormHref(test.patientId, test._id),
        openId: test._id,
      },
    });
  }
  // And anyone the desk routed here who has nothing ordered yet.
  for (const doc of patients) {
    const slot = doc.stationAssignments?.lab;
    if (!slot || slot.staffId !== currentUser._id || seen.has(doc._id)) continue;
    row(doc._id, patientDisplayName(doc), {
      ward: labels.assigned,
      division: labels.assigned,
      doctor: doc.assignedDoctorName || '',
      triagePriority: 'GREEN',
      assignmentStatus: 'assigned',
      assignmentNote: slot.note,
      station: {
        timeLabel: clock(slot.assignedAt),
        timeSubtext: agoLabel(slot.assignedAt, now),
        context: labels.assigned,
        contextSubtext: slot.assignedByName ? shortenPersonName(slot.assignedByName) : '',
        status: labels.assigned,
        statusTone: 'ready',
        statusSubtext: slot.note || '',
        lane: 'scheduled',
        chartHref: labFormHref(doc._id),
      },
    });
  }

  const entry = (r: LabResultDoc): OutstandingEntry => ({
    id: r._id,
    title: shortenPersonName(r.patientName),
    subtitle: r.orderedBy ? `${r.testName} · ${r.orderedBy}` : r.testName,
    meta: clock(r.status === 'completed' ? r.completedAt : r.orderedAt),
    tone: r.critical ? 'danger' : r.status === 'completed' ? 'neutral' : 'warning',
    href: labFormHref(r.patientId, r._id),
    openId: r._id,
  });
  const toCollect = open.filter(r => labBenchStage(r) === 'collect');
  const onBench = open.filter(r => labBenchStage(r) === 'bench');
  const critical = tests.filter(r => r.critical && (r.status !== 'completed' || localDayOf(r.completedAt) === today));
  const assignedToMe = patients.filter(p => p.stationAssignments?.lab?.staffId === currentUser._id);

  const outstanding: OutstandingItem[] = [
    { label: labels.critical, count: critical.length, tone: critical.length ? 'danger' : 'neutral', entries: critical.map(entry) },
    { label: labels.collect, count: toCollect.length, tone: toCollect.length ? 'warning' : 'neutral', entries: toCollect.map(entry) },
    { label: labels.bench, count: onBench.length, tone: onBench.length ? 'warning' : 'neutral', entries: onBench.map(entry) },
    { label: labels.resultedToday, count: resultedToday.length, tone: 'neutral', entries: resultedToday.map(entry) },
    {
      label: labels.assigned,
      count: assignedToMe.length,
      tone: 'neutral',
      entries: assignedToMe.map(p => ({
        id: p._id,
        title: patientDisplayName(p),
        subtitle: p.stationAssignments?.lab?.note || p.hospitalNumber,
        meta: clock(p.stationAssignments?.lab?.assignedAt),
        tone: 'neutral' as const,
        href: labFormHref(p._id),
      })),
    },
  ];

  // Week bars: ordered (series 0) vs resulted (series 1). A resulted test is
  // plotted when it resulted, an open one when it was ordered.
  const activity: DayStatsItem[] = tests.map(r => {
    const resulted = r.status === 'completed';
    const at = (resulted && r.completedAt) || r.orderedAt;
    return { date: localDayOf(at), time: localClockOf(at), series: (resulted ? 1 : 0) as 0 | 1 };
  });

  const minutes = resultedToday
    .map(r => (Date.parse(r.completedAt) - Date.parse(r.orderedAt)) / 60000)
    .filter(m => Number.isFinite(m) && m >= 0)
    .sort((a, b) => a - b);
  const turnaroundMinutes = minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)]) : null;
  const oldestOpen = [...open].sort((a, b) => (a.orderedAt || '').localeCompare(b.orderedAt || ''))[0] ?? null;

  return {
    patients: rows,
    outstanding,
    activity,
    counts: { collect: toCollect.length, bench: onBench.length, resulted: resultedToday.length },
    turnaroundMinutes,
    oldestOpen,
  };
}

export default function LabHomeView({ onBatchEntry }: { onBatchEntry?: () => void }) {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const { patients } = usePatients();
  const { appointments } = useAppointments();
  const { results } = useLabResults();
  const { canEnterLabResults } = usePermissions();
  // The test open in the slider, by id so it follows the record step to step.
  const [bench, setBench] = useState<{ id: string; intent?: 'reject' } | null>(null);
  const [intake, setIntake] = useState<{ patientId?: string } | null>(null);
  // The turnaround card's "longest waiting" clock, refreshed each minute.
  const nowMs = useNow(60_000);

  const labels: LabWorklistLabels = useMemo(() => ({
    collect: t('labHome.toCollect'),
    bench: t('labHome.onBench'),
    resulted: t('labHome.resulted'),
    critical: t('labHome.criticalResults'),
    assigned: t('labHome.assignedToMe'),
    resultedToday: t('labHome.resultedToday'),
    tests: (count: number) => t('labHome.testCount', { count }),
    t,
  }), [t]);

  const worklist = useMemo(
    () => (currentUser ? assembleLabWorklist({ currentUser, patients, results, labels }) : null),
    [currentUser, patients, results, labels],
  );

  if (!currentUser || !worklist) return null;

  const today = toIsoDate(new Date());
  // The row's panel leads with the patient's tests: each one's stage, and the
  // way into it on the bench. Open tests and today's results only.
  const stationDetail = (patientId: string): ReactNode => {
    const mine = results.filter(r => r.patientId === patientId && !isImagingStudy(r)
      && (r.status !== 'completed' || localDayOf(r.completedAt) === today));
    if (!mine.length) {
      // Sent here by the desk with nothing ordered: the lab takes the request.
      return canEnterLabResults ? (
        <div className="ehr-visit-pop-row">
          <span className="ehr-visit-pop-label">{t('visits.labs')}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setIntake({ patientId })}>{t('labIntake.title')}</button>
        </div>
      ) : null;
    }
    return (
      <div className="ehr-visit-pop-row">
        <span className="ehr-visit-pop-label">{t('visits.labs')}</span>
        <EhrPatientOrderList
          label={t('visits.labs')}
          orders={mine.map(r => ({
            id: r._id,
            title: r.testName,
            detail: [r.specimen, r.accessionNumber].filter(Boolean).join(' · '),
            note: labBenchStage(r) === 'resulted'
              ? `${r.result}${r.unit ? ` ${r.unit}` : ''}${r.referenceRange ? ` (${r.referenceRange})` : ''}`
              : r.clinicalNotes,
            // The button names the next step, so no pill says it a second time.
            actions: (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setBench({ id: r._id })}>
                {t(benchActionLabel(effectiveOrderStatus(r)))}
              </button>
            ),
          }))}
        />
      </div>
    );
  };

  const oldest = worklist.oldestOpen;
  const oldestMinutes = oldest ? Math.max(0, Math.round((nowMs - Date.parse(oldest.orderedAt)) / 60000)) : null;
  const benchOrder = bench ? results.find(r => r._id === bench.id) : undefined;
  const headerActions = [
    ...(onBatchEntry ? [{ key: 'batch', label: t('lab.batchEntry'), icon: Table, run: onBatchEntry }] : []),
  ];

  return (
    <main className="page-container page-enter">
      <EhrClinicalDashboard
        clinicianName={currentUser.name || 'lab'}
        patients={worklist.patients}
        appointments={appointmentsVisibleToUser(appointments, currentUser)}
        outstanding={worklist.outstanding}
        activityItems={worklist.activity}
        activitySeriesNames={[t('labHome.ordered'), t('labHome.resulted')]}
        laneLabels={{ scheduled: labels.collect, in_office: labels.bench, finished: labels.resulted }}
        acuityDonut={{
          title: t('labHome.benchToday'),
          centerLabel: t('labHome.tests'),
          segments: [
            { name: labels.collect, value: worklist.counts.collect, color: '#B35900' },
            { name: labels.bench, value: worklist.counts.bench, color: '#015697' },
            { name: labels.resulted, value: worklist.counts.resulted, color: '#0A6E4A' },
          ],
        }}
        railCards={(
          <section className="ehr-side-card">
            <div className="ehr-side-card-head">
              <Timer className="w-5 h-5" />
              <EhrPanelTitle title={t('labHome.turnaround')} />
            </div>
            <dl className="ehr-station-facts">
              <div><dt>{t('labHome.medianToday')}</dt><dd>{worklist.turnaroundMinutes === null ? '—' : durationLabel(worklist.turnaroundMinutes)}</dd></div>
              <div><dt>{t('labHome.longestWaiting')}</dt><dd>{oldest && oldestMinutes !== null ? `${durationLabel(oldestMinutes)} · ${oldest.testName}` : '—'}</dd></div>
            </dl>
          </section>
        )}
        stationDetail={stationDetail}
        railAction={canEnterLabResults ? { label: t('labIntake.title'), icon: Plus, run: () => setIntake({}) } : undefined}
        onStationOpen={(id, action) => setBench({ id, intent: action === 'reject' ? 'reject' : undefined })}
        canWriteNotes={false}
        extraHeaderActions={headerActions.length ? headerActions : undefined}
        missionTitle={t('mission.lab.title')}
        missionDescription={t('mission.lab.body')}
        missionIcon={Microscope}
      />
      {benchOrder && <LabBenchSlider order={benchOrder} patientName={shortenPersonName(benchOrder.patientName)} intent={bench?.intent} onClose={() => setBench(null)} />}
      {intake && (
        <LabIntakeSlider
          presetPatientId={intake.patientId}
          onClose={() => setIntake(null)}
          onPlaced={orderId => { setIntake(null); setBench({ id: orderId }); }}
        />
      )}
    </main>
  );
}
