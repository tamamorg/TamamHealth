'use client';

/**
 * The pharmacist's home: the doctor's dashboard (EhrClinicalDashboard), worked
 * in counter terms.
 *
 * One row per patient — their most pressing script names the row, the rest
 * are a count — and every lane, count and chart is the counter's: scripts to
 * receive, scripts being worked, scripts dispensed. The script itself is
 * worked in the patient chart, in the dispensing form (`?form=dispense`),
 * where the counter's six steps already live beside the allergy list.
 *
 * Patients the front desk sent to this pharmacist (`stationAssignments.pharmacy`)
 * are on the list even before a script reaches the counter.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Package, Pill, ShieldCheck } from '@/components/icons/lucide';
import EhrClinicalDashboard, {
  type WorklistPatient,
  type OutstandingItem,
  type OutstandingEntry,
} from '@/components/ehr/EhrClinicalDashboard';
import EhrPanelTitle from '@/components/ehr/EhrPanelTitle';
import { EhrPatientOrderList, withOthers } from '@/components/ehr/EhrPatientOrders';
import { statusToneClass } from '@/components/ehr/EhrCareDashboard';
import type { DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import { classifyStockStatus } from '@/lib/services/pharmacy-inventory-service';
import { isOutsidePharmacyOrder, pharmacyStage, pharmacyStageGroup, pharmacyStageLabel, pharmacyStageTone } from '@/lib/pharmacy-workflow';
import { comparePharmacyPriority } from '@/lib/clinical-flow/medication-tiers';
import { formatRxSig } from '@/lib/format-utils';
import { hasSafetyWarning } from '@/lib/pharmacy/rx-safety';
import { agoLabel, shortDayLabel } from '@/lib/station-time';
import { patientDisplayName, patientAge, shortenPersonName } from '@/lib/patient-utils';
import { appointmentsVisibleToUser } from '@/lib/appointment-visibility';
import { localClockOf, localDayOf, toIsoDate } from '@/lib/date-utils';
import { counterActions, counterPillLabel, isParked } from '@/components/pharmacy/workflow/pharmacy-workflow-types';
import DispenseSlider from '@/components/pharmacy/workflow/DispenseSlider';
import type { RxIntent } from '@/components/pharmacy/workflow/PharmacyWorkflowPanel';
import type { PatientDoc, PharmacyInventoryDoc, PrescriptionDoc } from '@/lib/db-types';

/** Opens the chart with the dispensing form up, on one script when `rxId` is given. */
export function dispenseFormHref(patientId: string, rxId?: string): string {
  const focus = rxId ? `&focus=${encodeURIComponent(rxId)}` : '';
  return `/patients/${encodeURIComponent(patientId)}?form=dispense${focus}`;
}


export interface PharmacyWorklistLabels {
  safety: string;
  toReceive: string;
  ready: string;
  toCounsel: string;
  dispensedToday: string;
  assigned: string;
  immediate: string;
  scripts: (count: number) => string;
  /** Translates a row's next-step labels. */
  t?: (key: string) => string;
}

export interface PharmacyWorklistInput {
  currentUser: { _id: string; name?: string };
  patients: PatientDoc[];
  prescriptions: PrescriptionDoc[];
  labels: PharmacyWorklistLabels;
  now?: Date;
}

export interface PharmacyWorklistResult {
  patients: WorklistPatient[];
  outstanding: OutstandingItem[];
  activity: DayStatsItem[];
  counts: { queued: number; working: number; dispensed: number };
}

export function assemblePharmacyWorklist({
  currentUser, patients, prescriptions, labels, now = new Date(),
}: PharmacyWorklistInput): PharmacyWorklistResult {
  const today = toIsoDate(now);
  const patientById = new Map(patients.map(p => [p._id, p]));
  // Scripts written for an outside pharmacy are the patient's to fill.
  const scripts = prescriptions.filter(rx => !isOutsidePharmacyOrder(rx));
  const open = scripts
    .filter(rx => rx.status !== 'discontinued' && pharmacyStageGroup(pharmacyStage(rx)) !== 'finished')
    .sort((a, b) => Number(hasSafetyWarning(b)) - Number(hasSafetyWarning(a))
      || Number(b.urgency === 'immediate') - Number(a.urgency === 'immediate')
      || comparePharmacyPriority(a, b));
  const dispensedToday = scripts.filter(rx => pharmacyStageGroup(pharmacyStage(rx)) === 'finished'
    && rx.status !== 'discontinued' && localDayOf(rx.dispensedAt || rx.updatedAt) === today);
  const clock = (iso?: string) => (iso && localDayOf(iso) === today ? localClockOf(iso) : shortDayLabel(iso));

  const rows: WorklistPatient[] = [];
  const seen = new Set<string>();
  const push = (patientId: string, name: string, base: Partial<WorklistPatient> & { station: NonNullable<WorklistPatient['station']> }) => {
    seen.add(patientId);
    const doc = patientById.get(patientId);
    const assignedTo = doc?.stationAssignments?.pharmacy;
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
      station: {
        ...base.station,
        careTeamSecondary: assignedTo ? `${labels.assigned}: ${shortenPersonName(assignedTo.staffName)}` : '',
      },
    });
  };

  for (const rx of open) {
    if (!rx.patientId || seen.has(rx.patientId)) continue;
    const mine = open.filter(r => r.patientId === rx.patientId);
    const stage = pharmacyStage(rx);
    const warned = mine.some(hasSafetyWarning);
    // No progress to report: a script is to fill, or parked waiting on an answer.
    const lane = isParked(rx.orderStatus || 'prescribed') ? 'in_office' as const : 'scheduled' as const;
    push(rx.patientId, rx.patientName, {
      ward: withOthers(rx.medication, mine.length - 1),
      division: withOthers(rx.medication, mine.length - 1),
      doctor: rx.prescribedBy || '',
      triagePriority: warned ? 'RED' : mine.some(r => r.urgency === 'immediate') ? 'YELLOW' : 'GREEN',
      assignmentStatus: lane === 'in_office' ? 'in_progress' : 'assigned',
      station: {
        timeLabel: clock(rx.createdAt),
        timeSubtext: agoLabel(rx.createdAt, now),
        context: withOthers(rx.medication, mine.length - 1),
        contextSubtext: mine.length > 1 ? mine.slice(1).map(r => r.medication).join(', ') : formatRxSig(rx),
        status: labels.t ? counterPillLabel(rx.orderStatus || 'prescribed', labels.t) : pharmacyStageLabel(stage),
        statusTone: warned ? 'danger' : pharmacyStageTone(stage),
        statusSubtext: warned ? labels.safety
          : mine.some(r => r.urgency === 'immediate') ? labels.immediate
          : mine.length > 1 ? labels.scripts(mine.length) : '',
        lane,
        chartHref: dispenseFormHref(rx.patientId, rx._id),
        openId: rx._id,
        actions: labels.t ? counterActions(rx.orderStatus || 'prescribed', labels.t) : undefined,
      },
    });
  }
  // Everything given out today is under Dispensed, even for a patient who still
  // has scripts to fill: that patient has a row in each lane.
  const dispensedRows = new Set<string>();
  for (const rx of dispensedToday) {
    if (!rx.patientId || dispensedRows.has(rx.patientId)) continue;
    dispensedRows.add(rx.patientId);
    const mine = dispensedToday.filter(r => r.patientId === rx.patientId);
    push(rx.patientId, rx.patientName, {
      ward: withOthers(rx.medication, mine.length - 1),
      division: withOthers(rx.medication, mine.length - 1),
      doctor: rx.prescribedBy || '',
      triagePriority: 'GREEN',
      assignmentStatus: 'completed',
      station: {
        timeLabel: clock(rx.dispensedAt || rx.updatedAt),
        timeSubtext: agoLabel(rx.dispensedAt || rx.updatedAt, now),
        context: withOthers(rx.medication, mine.length - 1),
        contextSubtext: mine.length > 1 ? mine.slice(1).map(r => r.medication).join(', ') : formatRxSig(rx),
        status: labels.t ? counterPillLabel(rx.orderStatus || 'prescribed', labels.t) : pharmacyStageLabel(pharmacyStage(rx)),
        statusTone: 'done',
        statusSubtext: mine.length > 1 ? labels.scripts(mine.length) : '',
        lane: 'finished',
        rowKey: `${rx.patientId}:dispensed`,
        chartHref: dispenseFormHref(rx.patientId, rx._id),
        openId: rx._id,
      },
    });
  }
  for (const doc of patients) {
    const slot = doc.stationAssignments?.pharmacy;
    if (!slot || slot.staffId !== currentUser._id || seen.has(doc._id)) continue;
    push(doc._id, patientDisplayName(doc), {
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
        chartHref: dispenseFormHref(doc._id),
      },
    });
  }

  const entry = (rx: PrescriptionDoc): OutstandingEntry => ({
    id: rx._id,
    title: shortenPersonName(rx.patientName),
    subtitle: rx.prescribedBy ? `${rx.medication} · ${rx.prescribedBy}` : rx.medication,
    meta: clock(rx.createdAt),
    tone: hasSafetyWarning(rx) ? 'danger' : 'warning',
    href: dispenseFormHref(rx.patientId, rx._id),
    openId: rx._id,
  });
  const safety = open.filter(hasSafetyWarning);
  const toReceive = open.filter(rx => ['prescribed', 'received_in_pharmacy_queue'].includes(pharmacyStage(rx)));
  const ready = open.filter(rx => pharmacyStage(rx) === 'cleared_for_dispensing');
  const toCounsel = scripts.filter(rx => pharmacyStage(rx) === 'dispensed' && rx.status !== 'discontinued');
  const assignedToMe = patients.filter(p => p.stationAssignments?.pharmacy?.staffId === currentUser._id);

  const outstanding: OutstandingItem[] = [
    { label: labels.safety, count: safety.length, tone: safety.length ? 'danger' : 'neutral', entries: safety.map(entry) },
    { label: labels.toReceive, count: toReceive.length, tone: toReceive.length ? 'warning' : 'neutral', entries: toReceive.map(entry) },
    { label: labels.ready, count: ready.length, tone: ready.length ? 'warning' : 'neutral', entries: ready.map(entry) },
    { label: labels.toCounsel, count: toCounsel.length, tone: toCounsel.length ? 'warning' : 'neutral', entries: toCounsel.map(entry) },
    { label: labels.dispensedToday, count: dispensedToday.length, tone: 'neutral', entries: dispensedToday.map(rx => ({ ...entry(rx), tone: 'neutral' as const })) },
    {
      label: labels.assigned,
      count: assignedToMe.length,
      tone: 'neutral',
      entries: assignedToMe.map(p => ({
        id: p._id,
        title: patientDisplayName(p),
        subtitle: p.stationAssignments?.pharmacy?.note || p.hospitalNumber,
        meta: clock(p.stationAssignments?.pharmacy?.assignedAt),
        tone: 'neutral' as const,
        href: dispenseFormHref(p._id),
      })),
    },
  ];

  // Week bars: prescribed (series 0) vs dispensed (series 1).
  const activity: DayStatsItem[] = scripts.map(rx => {
    const done = pharmacyStageGroup(pharmacyStage(rx)) === 'finished';
    const at = (done && (rx.dispensedAt || rx.updatedAt)) || rx.createdAt;
    return { date: localDayOf(at), time: localClockOf(at), series: (done ? 1 : 0) as 0 | 1 };
  });

  return {
    patients: rows,
    outstanding,
    activity,
    counts: {
      queued: open.filter(rx => !isParked(rx.orderStatus || 'prescribed')).length,
      working: open.filter(rx => isParked(rx.orderStatus || 'prescribed')).length,
      dispensed: dispensedToday.length,
    },
  };
}

export default function PharmacyHomeView() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const { patients } = usePatients();
  const { appointments } = useAppointments();
  const { prescriptions } = usePrescriptions();
  // The script open in the slider, by id so it follows the record step to step.
  const [counter, setCounter] = useState<{ id: string; intent?: RxIntent } | null>(null);
  const { items: rawInventory } = usePharmacyInventory();

  const labels: PharmacyWorklistLabels = useMemo(() => ({
    safety: t('pharmacyHome.safetyReview'),
    toReceive: t('pharmacyHome.toReceive'),
    ready: t('pharmacyHome.readyToDispense'),
    toCounsel: t('pharmacyHome.toCounsel'),
    dispensedToday: t('pharmacyHome.dispensedToday'),
    assigned: t('labHome.assignedToMe'),
    immediate: t('pharmacyHome.immediate'),
    scripts: (count: number) => t('pharmacyHome.scriptCount', { count }),
    t,
  }), [t]);

  const worklist = useMemo(
    () => (currentUser ? assemblePharmacyWorklist({ currentUser, patients, prescriptions, labels }) : null),
    [currentUser, patients, prescriptions, labels],
  );

  // This facility's stock, classified live (expiry passes, levels drain).
  const myHospitalId = currentUser?.hospitalId;
  const stock = useMemo(() => {
    const statuses = rawInventory
      .filter((i: PharmacyInventoryDoc) => !myHospitalId || i.hospitalId === myHospitalId)
      .map(i => classifyStockStatus(i));
    return {
      low: statuses.filter(s => s === 'low').length,
      critical: statuses.filter(s => s === 'critical').length,
      expired: statuses.filter(s => s === 'expired').length,
    };
  }, [rawInventory, myHospitalId]);

  if (!currentUser || !worklist) return null;

  const counterRx = counter ? prescriptions.find(rx => rx._id === counter.id) : undefined;
  const today = toIsoDate(new Date());
  const stationDetail = (patientId: string): ReactNode => {
    const mine = prescriptions.filter(rx => rx.patientId === patientId && !isOutsidePharmacyOrder(rx)
      && rx.status !== 'discontinued'
      && (pharmacyStageGroup(pharmacyStage(rx)) !== 'finished' || localDayOf(rx.dispensedAt || rx.updatedAt) === today));
    if (!mine.length) return null;
    return (
      <div className="ehr-visit-pop-row">
        <span className="ehr-visit-pop-label">{t('tab.prescriptions')}</span>
        <EhrPatientOrderList
          label={t('tab.prescriptions')}
          orders={mine.map(rx => {
            const stage = pharmacyStage(rx);
            const warned = hasSafetyWarning(rx);
            return {
              id: rx._id,
              title: rx.medication,
              detail: formatRxSig(rx),
              note: warned ? labels.safety : (rx.pharmacyInstructions || rx.indication),
              // Named for the next step, so no pill says it a second time.
              actions: (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCounter({ id: rx._id })}>
                  {counterActions(rx.orderStatus || 'prescribed', t)[0]?.label ?? t('dashboard.open')}
                </button>
              ),
            };
          })}
        />
      </div>
    );
  };

  return (
    <main className="page-container page-enter">
      <EhrClinicalDashboard
        clinicianName={currentUser.name || 'pharmacy'}
        patients={worklist.patients}
        appointments={appointmentsVisibleToUser(appointments, currentUser)}
        outstanding={worklist.outstanding}
        activityItems={worklist.activity}
        activitySeriesNames={[t('pharmacyHome.prescribed'), t('pharmacyHome.dispensed')]}
        laneLabels={{ scheduled: t('rxFlow.pillToFill'), in_office: t('rxFlow.pillOnHold'), finished: t('pharmacyHome.dispensed') }}
        acuityDonut={{
          title: t('pharmacyHome.counterToday'),
          centerLabel: t('pharmacyHome.scripts'),
          segments: [
            { name: t('rxFlow.pillToFill'), value: worklist.counts.queued, color: '#B35900' },
            { name: t('rxFlow.pillOnHold'), value: worklist.counts.working, color: '#015697' },
            { name: t('pharmacyHome.dispensed'), value: worklist.counts.dispensed, color: '#0A6E4A' },
          ],
        }}
        railCards={(
          <section className="ehr-side-card">
            <div className="ehr-side-card-head">
              <Package className="w-5 h-5" />
              <EhrPanelTitle title={t('pharmacyHome.stock')} />
            </div>
            <dl className="ehr-station-facts">
              <div><dt>{t('pharmacy.kpiLowStock')}</dt><dd data-tone={stock.low ? 'warning' : undefined}>{stock.low}</dd></div>
              <div><dt>{t('pharmacyHome.criticalStock')}</dt><dd data-tone={stock.critical ? 'danger' : undefined}>{stock.critical}</dd></div>
              <div><dt>{t('pharmacyHome.expired')}</dt><dd data-tone={stock.expired ? 'danger' : undefined}>{stock.expired}</dd></div>
            </dl>
          </section>
        )}
        stationDetail={stationDetail}
        onStationOpen={(id, action) => setCounter({ id, intent: action === 'hold' || action === 'stockout' ? action : undefined })}
        canWriteNotes={false}
        extraHeaderActions={[
          { key: 'stock', label: t('pharmacyHome.inventory'), icon: Package, run: () => router.push('/pharmacy?tab=inventory') },
          { key: 'controlled', label: t('pharmacy.kpiControlled'), icon: ShieldCheck, run: () => router.push('/controlled-substances') },
        ]}
        missionTitle={t('mission.pharmacy.title')}
        missionDescription={t('mission.pharmacy.body')}
        missionIcon={Pill}
      />
      {counterRx && (
        <DispenseSlider
          rx={counterRx}
          patientName={shortenPersonName(counterRx.patientName)}
          activeMedications={prescriptions.filter(rx => rx.patientId === counterRx.patientId && rx._id !== counterRx._id && rx.status !== 'discontinued').map(rx => rx.medication).filter(Boolean)}
          intent={counter?.intent}
          onClose={() => setCounter(null)}
        />
      )}
    </main>
  );
}
