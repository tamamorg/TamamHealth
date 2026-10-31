'use client';

/**
 * The radiologist's home: the shared clinical workspace (EhrClinicalDashboard,
 * the doctor's dashboard), in imaging terms.
 *
 * The radiology station reported studies inside its own worklist popup. It now
 * works the way a doctor's day does: Book appointment, a worklist of patients
 * with open imaging orders, outstanding items, and the report written in the
 * patient chart (the chart's Imaging report form). Every to-do entry opens
 * that chart with the form up (`?form=imaging-report`).
 *
 * All modalities — X-ray, ultrasound, CT, MRI, fluoroscopy, mammography — are
 * the same imaging `lab_result` order, so they share one list and one form.
 */

import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ScanLine } from '@/components/icons/lucide';
import { useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import ImagingReportPanel from '@/components/ehr/chart/panels/ImagingReportPanel';
import '@/components/lab/workflow/lab-workflow.css';
import EhrClinicalDashboard, {
  type WorklistPatient,
  type OutstandingItem,
  type OutstandingEntry,
} from '@/components/ehr/EhrClinicalDashboard';
import type { DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { patientDisplayName, patientAge, shortenPersonName } from '@/lib/patient-utils';
import { appointmentsVisibleToUser } from '@/lib/appointment-visibility';
import { localClockOf, localDayOf, toIsoDate } from '@/lib/date-utils';
import { agoLabel, shortDayLabel } from '@/lib/station-time';
import type { LabResultDoc, PatientDoc } from '@/lib/db-types';

/** Opens the chart with the imaging report form up. */
export function imagingReportHref(patientId: string): string {
  return `/patients/${encodeURIComponent(patientId)}?form=imaging-report`;
}

export interface RadiologyWorklistInput {
  currentUser: { _id: string; name?: string };
  patients: PatientDoc[];
  /** Every order in scope; non-imaging ones are ignored. */
  results: LabResultDoc[];
  labels: {
    toPerform: string; toReport: string; urgent: string; reportedToday: string; assigned: string;
    /** What the row's dropdown offers for a study at this status. */
    nextAction?: (status: LabResultDoc['status']) => string;
  };
  now?: Date;
}

export interface RadiologyWorklistResult {
  patients: WorklistPatient[];
  outstanding: OutstandingItem[];
  activity: DayStatsItem[];
}

export function assembleRadiologyWorklist({
  currentUser, patients, results, labels, now = new Date(),
}: RadiologyWorklistInput): RadiologyWorklistResult {
  const patientById = new Map(patients.map(p => [p._id, p]));
  const studies = results.filter(r => isImagingStudy(r));
  const open = studies
    .filter(s => s.status !== 'completed')
    .sort((a, b) => Number(b.critical) - Number(a.critical) || (a.orderedAt || '').localeCompare(b.orderedAt || ''));

  // One row per patient: their most pressing open study names the row, the
  // rest are a count. Reporting is per study, in the chart form.
  const clockOf = (iso?: string) => (localDayOf(iso) === toIsoDate(now) ? localClockOf(iso) : shortDayLabel(iso));
  const rows: WorklistPatient[] = [];
  const seen = new Set<string>();
  for (const study of open) {
    if (!study.patientId || seen.has(study.patientId)) continue;
    seen.add(study.patientId);
    const more = open.filter(s => s.patientId === study.patientId).length - 1;
    const doc = patientById.get(study.patientId);
    const context = more > 0 ? `${study.testName} +${more}` : study.testName;
    rows.push({
      _id: study.patientId,
      photoUrl: doc?.photoUrl,
      name: doc ? patientDisplayName(doc) : shortenPersonName(study.patientName),
      age: doc ? patientAge(doc) : null,
      gender: doc?.gender?.[0] || '',
      id: doc?.hospitalNumber,
      ward: context,
      division: context,
      doctor: study.orderedBy || '',
      assignedDoctor: currentUser._id,
      assignedDoctorName: currentUser.name,
      assignmentStatus: study.status === 'in_progress' ? 'in_progress' : 'assigned',
      triagePriority: study.critical ? 'RED' : 'GREEN',
      station: {
        timeLabel: clockOf(study.orderedAt),
        timeSubtext: agoLabel(study.orderedAt, now),
        context,
        contextSubtext: study.specimen,
        status: study.status === 'in_progress' ? labels.toReport : labels.toPerform,
        statusTone: study.critical ? 'danger' : study.status === 'in_progress' ? 'active' : 'scheduled',
        statusSubtext: '',
        careTeamSecondary: '',
        lane: study.status === 'in_progress' ? 'in_office' : 'scheduled',
        chartHref: imagingReportHref(study.patientId),
        openId: study._id,
        actions: labels.nextAction ? [{ value: 'next', label: labels.nextAction(study.status) }] : undefined,
      },
    });
  }

  // And anyone the desk routed here who has no open study yet.
  const today = toIsoDate(now);
  const clock = (iso?: string) => (localDayOf(iso) === today ? localClockOf(iso) : shortDayLabel(iso));
  const assignedToMe = patients.filter(p => p.stationAssignments?.radiology?.staffId === currentUser._id);
  for (const doc of assignedToMe) {
    if (seen.has(doc._id)) continue;
    const slot = doc.stationAssignments!.radiology!;
    rows.push({
      _id: doc._id,
      photoUrl: doc.photoUrl,
      name: patientDisplayName(doc),
      age: patientAge(doc),
      gender: doc.gender?.[0] || '',
      id: doc.hospitalNumber,
      ward: labels.assigned,
      division: labels.assigned,
      doctor: doc.assignedDoctorName || '',
      assignedDoctor: currentUser._id,
      assignedDoctorName: currentUser.name,
      assignmentStatus: 'assigned',
      assignmentNote: slot.note,
      triagePriority: 'GREEN',
      station: {
        timeLabel: clock(slot.assignedAt),
        timeSubtext: agoLabel(slot.assignedAt, now),
        context: labels.assigned,
        contextSubtext: slot.assignedByName ? shortenPersonName(slot.assignedByName) : '',
        status: labels.assigned,
        statusTone: 'ready',
        statusSubtext: slot.note || '',
        lane: 'scheduled',
        chartHref: imagingReportHref(doc._id),
        openId: doc._id,
      },
    });
  }

  const entry = (s: LabResultDoc): OutstandingEntry => ({
    id: s._id,
    title: shortenPersonName(s.patientName),
    subtitle: s.orderedBy ? `${s.testName} · ${s.orderedBy}` : s.testName,
    // The list's When column: the order's clock time, or its day if older.
    meta: localDayOf(s.orderedAt) === toIsoDate(now) ? localClockOf(s.orderedAt) : localDayOf(s.orderedAt),
    tone: s.critical ? 'danger' : 'warning',
    href: imagingReportHref(s.patientId),
  });
  const toPerform = open.filter(s => s.status === 'pending');
  const toReport = open.filter(s => s.status === 'in_progress');
  const urgent = open.filter(s => s.critical);
  const reportedToday = studies.filter(s => s.status === 'completed'
    && localDayOf(s.reportedAt || s.completedAt) === today);

  const outstanding: OutstandingItem[] = [
    { label: labels.urgent, count: urgent.length, tone: urgent.length ? 'danger' : 'neutral', entries: urgent.map(entry) },
    { label: labels.toPerform, count: toPerform.length, tone: toPerform.length ? 'warning' : 'neutral', entries: toPerform.map(entry) },
    { label: labels.toReport, count: toReport.length, tone: toReport.length ? 'warning' : 'neutral', entries: toReport.map(entry) },
    {
      label: labels.reportedToday,
      count: reportedToday.length,
      tone: 'neutral',
      entries: reportedToday.map(s => ({ ...entry(s), tone: 'neutral' as const })),
    },
    {
      label: labels.assigned,
      count: assignedToMe.length,
      tone: 'neutral',
      entries: assignedToMe.map(p => ({
        id: p._id,
        title: patientDisplayName(p),
        subtitle: p.stationAssignments?.radiology?.note || p.hospitalNumber,
        meta: clock(p.stationAssignments?.radiology?.assignedAt),
        tone: 'neutral' as const,
        href: imagingReportHref(p._id),
      })),
    },
  ];

  // Week bars: ordered (series 0) vs reported (series 1). A reported study is
  // plotted when it was read, an open one when it was ordered.
  const activity: DayStatsItem[] = studies.map(s => {
    const reported = s.status === 'completed';
    const at = (reported && (s.reportedAt || s.completedAt)) || s.orderedAt;
    return { date: localDayOf(at), time: localClockOf(at), series: (reported ? 1 : 0) as 0 | 1 };
  });

  return { patients: rows, outstanding, activity };
}

export default function RadiologyHomeView() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const { patients } = usePatients();
  const { appointments } = useAppointments();
  const { results } = useLabResults();
  // Whose studies are open in the slider.
  const [reportFor, setReportFor] = useState<string | null>(null);

  if (!currentUser) return null;

  const worklist = assembleRadiologyWorklist({
    currentUser, patients, results,
    labels: {
      urgent: t('radiology.kpiUrgentEmergency'),
      toPerform: t('radiologyHome.toPerform'),
      toReport: t('radiologyHome.toReport'),
      reportedToday: t('radiologyHome.reportedToday'),
      assigned: t('labHome.assignedToMe'),
      nextAction: status => t(status === 'in_progress' ? 'radiologyHome.actionReport' : 'radiologyHome.actionPerform'),
    },
  });
  // A row names a study, or a patient the desk sent with no study yet.
  const reportStudy = reportFor ? results.find(r => r._id === reportFor) : undefined;
  const reportPatient = reportFor ? patients.find(p => p._id === (reportStudy?.patientId ?? reportFor)) : undefined;

  return (
    <main className="page-container page-enter">
      <EhrClinicalDashboard
        clinicianName={currentUser.name || 'radiologist'}
        patients={worklist.patients}
        appointments={appointmentsVisibleToUser(appointments, currentUser)}
        outstanding={worklist.outstanding}
        activityItems={worklist.activity}
        activitySeriesNames={[t('radiologyHome.ordered'), t('radiologyHome.reported')]}
        missionTitle={t('mission.radiology.title')}
        missionDescription={t('mission.radiology.body')}
        missionIcon={ScanLine}
        onStationOpen={setReportFor}
      />
      {reportPatient && (
        <FormSlider title={reportStudy?.testName ?? t('radiologyHome.reportTitle')} subtitle={patientDisplayName(reportPatient)} className="tamam-dialog" width={560} flush onClose={() => setReportFor(null)}>
          <div className="station-form-slider o3f-scroll">
            <ImagingReportPanel patient={reportPatient} currentUser={currentUser} focusId={reportStudy?._id} onClose={() => setReportFor(null)} />
          </div>
        </FormSlider>
      )}
    </main>
  );
}
