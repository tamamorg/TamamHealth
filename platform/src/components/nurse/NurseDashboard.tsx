'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  ArrowRightLeft, Calendar, Printer,
  PieChart as PieChartIcon,
} from '@/components/icons/lucide';
import { usePatients } from '@/lib/hooks/usePatients';
import { useTriage } from '@/lib/hooks/useTriage';
import { useWards } from '@/lib/hooks/useWards';
import { useRooming } from '@/lib/hooks/useRooming';
import { patientFullName, patientGenderAge, patientRegisteredAt } from '@/lib/patient-utils';
import { getRoleConfig } from '@/lib/permissions';
import { DEMO_WARD_PATIENTS, IS_DEMO, useMarEntries } from '@/components/nurse/shared';
import EhrCareDashboard, { type EhrCareDashboardAction, type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { PRIORITY_META } from '@/lib/clinical/triage-display';
import { tooltipStyle } from '@/components/ChartCard';
import WardWorkflow from './WardWorkflow';
import MarWorkflow from './MarWorkflow';
import RoomingWorkflow from './RoomingWorkflow';
import TriageWorkflow from './TriageWorkflow';
import HandoffWorkflow from './HandoffWorkflow';
import PrintListDialog, { type PrintListSection } from '@/components/PrintListDialog';

/* Handoff is no longer a station: it is a dialog raised by "Start handoff", so
   it has no tab and no board of its own. Triage and rooming remain addressable
   stations — the "New triage" action and queue deep links open them — but they
   are not offered as tabs either; the strip is the two boards a nurse parks on
   for a shift. */
type StationTab = 'triage' | 'ward' | 'mar' | 'rooming';
const STATION_TABS: readonly StationTab[] = ['triage', 'ward', 'mar', 'rooming'];

function isStationTab(value: string | null): value is StationTab {
  return !!value && STATION_TABS.includes(value as StationTab);
}

// Chart palette per design spec: flat clinical look, matched to triage colors.
const CHART_GREEN = 'var(--color-success)';
const CHART_RED = 'var(--color-danger)';
const CHART_AMBER = 'var(--color-warning)';

// Only plots a time when the source field is a full timestamp (contains a
// clock component) — registration/admission dates are sometimes date-only,
// and an invented hour would misreport when the work actually happened.
function rowTime(iso?: string): string | undefined {
  if (!iso || !/T\d{2}:\d{2}/.test(iso)) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function NurseDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { patients } = usePatients();
  const { triages } = useTriage();
  const { activeAdmissions } = useWards();
  const { entries: roomingEntries } = useRooming();
  const { marEntries } = useMarEntries();
  const today = new Date().toISOString().slice(0, 10);
  const triageToday = triages.filter(tr => (tr.triagedAt || '').startsWith(today));
  const criticalTriage = triageToday.filter(tr => tr.priority === 'RED').length;
  // Ward-roster acuity/status counts, mirrored from the Ward patients view so
  // the station side card carries the same at-a-glance numbers.
  const urgentTriage = triageToday.filter(tr => tr.priority === 'YELLOW').length;
  const waitingTriage = triageToday.filter(tr => tr.status === 'pending').length;
  const inConsultTriage = triageToday.filter(tr => tr.status === 'seen').length;
  const routineTriage = triageToday.filter(tr => tr.priority === 'GREEN').length;

  // Triage queue by acuity — today's RED/YELLOW/GREEN split, straight from
  // triage-service data already loaded above (no extra fetch).
  const triageAcuityData = useMemo(() => ([
    { name: 'Red', value: criticalTriage, color: CHART_RED },
    { name: 'Yellow', value: urgentTriage, color: CHART_AMBER },
    { name: 'Green', value: routineTriage, color: CHART_GREEN },
  ]), [criticalTriage, urgentTriage, routineTriage]);

  // The station is URL-addressable so notifications, redirects, bookmarks, and
  // the browser back button can return a nurse to the exact station they need.
  const [fallbackStation, setFallbackStation] = useState<StationTab | null>(() => (
    isStationTab(searchParams.get('station')) ? searchParams.get('station') as StationTab : null
  ));
  const urlStation = searchParams.get('station');
  // Every nurse lands on the ward list, the way every other module opens on its
  // worklist. Rooming nurses used to open on the Rooming board instead, which
  // made the module the one place in the app where what you saw first depended
  // on your role; Rooming is one click away, and triage arrives by deep link.
  const defaultStation: StationTab = 'ward';
  const activeTab: StationTab = isStationTab(urlStation) ? urlStation : (fallbackStation ?? defaultStation);

  // Plot the same work represented by the active tab. Ward plots admissions,
  // MAR plots dose slots, and Rooming plots rooming encounters; switching tabs
  // therefore changes both the list and the rail's visual language together.
  const chartItems = useMemo<DayStatsItem[]>(() => {
    if (activeTab === 'triage') return triageToday.map(triage => ({
      date: (triage.triagedAt || today).slice(0, 10),
      time: rowTime(triage.triagedAt),
      series: triage.priority === 'RED' ? 0 : 1,
    }));
    if (activeTab === 'rooming') return roomingEntries.map(entry => ({
      date: (entry.encounter.startedAt || entry.encounter.createdAt || today).slice(0, 10),
      time: rowTime(entry.encounter.startedAt || entry.encounter.createdAt),
      series: entry.step === 'being_roomed' ? 1 : 0,
    }));
    if (activeTab === 'mar') return marEntries.map(entry => ({ date: today, time: entry.time, series: entry.status === 'given' ? 1 : 0 }));
    const wardActivity = activeAdmissions.length > 0 || !IS_DEMO
      ? activeAdmissions.map(admission => ({
      date: (admission.admissionDate || today).slice(0, 10),
      time: rowTime(admission.admissionDate),
      series: (admission.severity === 'critical' || admission.severity === 'severe' ? 0 : 1) as 0 | 1,
      }))
      : DEMO_WARD_PATIENTS.map(patient => ({ date: today, time: undefined, series: (patient._triage?.priority === 'RED' || patient._triage?.priority === 'YELLOW' ? 0 : 1) as 0 | 1 }));
    return wardActivity;
  }, [activeAdmissions, activeTab, marEntries, roomingEntries, today, triageToday]);

  // Free-text search for the station lives in the LEFT RAIL (between the
  // mini-calendar and the day chart); WardWorkflow receives it as a prop so
  // the board has no inline search bar of its own.
  const [railSearch, setRailSearch] = useState('');

  // The shift handoff, as a dialog over whichever board the nurse is on.
  // `?station=handoff` still opens it, so the /dashboard/nurse/handoff redirect,
  // the shift tour and any existing bookmark all land on the same thing they
  // used to — it is a dialog now rather than a fifth board.
  const [handoffOpen, setHandoffOpen] = useState(urlStation === 'handoff');
  useEffect(() => {
    if (urlStation === 'handoff') setHandoffOpen(true);
  }, [urlStation]);

  const stationLabel = useMemo<Record<StationTab, string>>(() => ({
    triage: 'Triage',
    ward: t('nurse.tabWard'),
    mar: t('nurse.tabMar'),
    rooming: 'Rooming',
  }), [t]);

  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;

  // Tab counts must match what each station board actually displays. The ward
  // board (shared.tsx `wardPatients`) lists the active admissions, swapping in
  // the demo roster only when there are none in demo mode — mirror that rule
  // here so the tab never says "0" above a visibly populated board.
  const wardAdmittedCount = new Set(activeAdmissions.map(a => a.patientId)).size;
  const wardBoardCount = (wardAdmittedCount > 0 || !IS_DEMO) ? wardAdmittedCount : DEMO_WARD_PATIENTS.length;
  // All three nursing workboards are first-class tabs. Their counts come from
  // the same sources that render each board, so the tab never disagrees with
  // the visible list.
  const stationTabs = useMemo(() => ([
    { key: 'triage' as const, label: 'Triage', count: triages.length },
    { key: 'ward' as const, label: stationLabel.ward, count: wardBoardCount },
    { key: 'mar' as const, label: stationLabel.mar, count: marEntries.length },
    { key: 'rooming' as const, label: stationLabel.rooming, count: roomingEntries.length },
  ]), [marEntries.length, roomingEntries.length, stationLabel, triages.length, wardBoardCount]);

  const selectStation = useCallback((station: StationTab) => {
    setFallbackStation(station);
    const params = new URLSearchParams(searchParams.toString());
    params.set('station', station);
    // A triage deep link may contain a patient id. Clear it whenever the user
    // changes stations so a later return to Triage does not reopen stale work.
    params.delete('patient');
    // Push station changes so browser Back returns to the previous station.
    router.push(`/dashboard/nurse?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Ward/MAR/Triage/Rooming/Handoff switch via the daybar tabs.
  const daybarTabs = stationTabs;

  // "Print" — choose which board and which output (paper/PDF or CSV) instead
  // of window.print()'s whole-dashboard dump.
  const [printOpen, setPrintOpen] = useState(false);

  // Header actions mirror the appointment dashboard: create an appointment,
  // print the active register, or start a handoff.
  const actions = useMemo<EhrCareDashboardAction[]>(() => ([
    { label: 'Admit new patient', icon: Calendar, onClick: () => router.push('/appointments?new=1'), tone: 'primary' },
    { label: 'Print', icon: Printer, onClick: () => setPrintOpen(true), tone: 'neutral' },
    { label: 'Start Handoff', icon: ArrowRightLeft, onClick: () => setHandoffOpen(true), tourTarget: 'start-handoff', tone: 'primary' },
  ]), [router]);

  // The print dialog's choices: the station's two standing registers as pure
  // text lists — the full ward roster and today's triage, uncapped and
  // unfiltered by the rail search. Built only while the dialog is open.
  const printSections: PrintListSection[] = printOpen ? [
    {
      key: 'ward',
      label: 'Ward patients',
      columns: [
        { key: 'patient', label: 'Patient' },
        { key: 'mrn', label: 'MRN' },
        { key: 'location', label: 'Location' },
        { key: 'diagnosis', label: 'Diagnosis' },
        { key: 'careTeam', label: 'Care team' },
        { key: 'status', label: 'Status' },
      ],
      // Same fallback rule as the board and its tab count: real admissions,
      // or the demo roster in demo mode so paper matches the screen.
      rows: (activeAdmissions.length > 0 || !IS_DEMO)
        ? activeAdmissions.map(admission => ({
          patient: admission.patientName,
          mrn: admission.hospitalNumber || '',
          location: admission.bedNumber ? `${admission.wardName} · Bed ${admission.bedNumber}` : admission.wardName,
          diagnosis: admission.admittingDiagnosis || '',
          careTeam: [
            admission.attendingPhysicianName || 'Doctor unassigned',
            admission.nurseAssignedName || 'Nurse unassigned',
          ].join(' · '),
          status: admission.severity === 'critical' ? 'Critical' : admission.severity === 'severe' ? 'Severe' : 'Stable',
        }))
        : DEMO_WARD_PATIENTS.map(demo => ({
          patient: `${demo.firstName || ''} ${demo.surname || ''}`.trim(),
          mrn: demo.hospitalNumber || '',
          location: 'Ward',
          diagnosis: demo._triage?.chiefComplaint || '',
          careTeam: 'Doctor unassigned · Nurse unassigned',
          status: demo._triage ? PRIORITY_META[demo._triage.priority].label : '',
        })),
    },
    {
      key: 'triage',
      label: "Today's triage",
      columns: [
        { key: 'patient', label: 'Patient' },
        { key: 'time', label: 'Time' },
        { key: 'complaint', label: 'Complaint' },
        { key: 'acuity', label: 'Acuity' },
        { key: 'status', label: 'Status' },
        { key: 'room', label: 'Room' },
      ],
      rows: triageToday.map(triage => ({
        patient: triage.patientName,
        time: rowTime(triage.triagedAt) || '',
        complaint: triage.chiefComplaint || 'ETAT assessment',
        acuity: PRIORITY_META[triage.priority].label,
        status: triage.status === 'seen' ? 'Seen' : triage.status === 'pending' ? 'Waiting' : triage.status,
        room: triage.assignedRoom || '',
      })),
    },
  ] : [];

  // Patient portraits by id, so triage and ward rows show the same face as the
  // patient register instead of falling back to initials.
  const photoByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const patient of patients) {
      const photo = (patient as { photoUrl?: string }).photoUrl;
      if (photo) map.set(patient._id, photo);
    }
    return map;
  }, [patients]);

  const rows = useMemo<EhrCareDashboardRow[]>(() => {
    // The rail search filters the centre work list on every tab. Filtering
    // happens BEFORE the 10-row cap, so a match further down the queue is
    // still reachable instead of being sliced away first.
    const q = railSearch.trim().toLowerCase();
    const hit = (...values: Array<unknown>) =>
      !q || values.some(value => String(value ?? '').toLowerCase().includes(q));

    if (activeTab === 'mar') {
      return activeAdmissions.filter(admission => hit(
        admission.patientName, admission.wardName, admission.bedNumber, admission.hospitalNumber,
        admission.admittingDiagnosis, admission.attendingPhysicianName, admission.nurseAssignedName,
      )).slice(0, 10).map(admission => {
        const time = rowTime(admission.admissionDate);
        return {
          id: admission._id,
          photoUrl: photoByPatientId.get(admission.patientId),
          title: admission.patientName,
          subtitle: `${admission.wardName}${admission.bedNumber ? ` · Bed ${admission.bedNumber}` : ''}`,
          meta: `${admission.hospitalNumber || 'No MRN'} · ${admission.admittingDiagnosis || 'No diagnosis'} · ${admission.attendingPhysicianName || 'No physician'}`,
          time,
          timeSecondary: (admission.admissionDate || today).slice(0, 10),
          status: 'admitted',
          statusLabel: 'Admitted',
          statusSecondary: admission.severity === 'critical' ? 'Critical' : admission.severity === 'severe' ? 'Severe' : 'Stable',
          statusTone: admission.severity === 'critical' ? 'danger' : admission.severity === 'severe' ? 'warning' : 'ready',
          chartSeries: (admission.severity === 'critical' || admission.severity === 'severe' ? 0 : 1) as 0 | 1,
          // Admission severity is a real acuity — same RED/YELLOW pill as
          // triage, not a free-text label.
          priority: admission.severity === 'critical' ? 'RED' : admission.severity === 'severe' ? 'YELLOW' : undefined,
          careTeam: admission.attendingPhysicianName || 'Doctor unassigned',
          careTeamSecondary: admission.nurseAssignedName || 'Nurse unassigned',
          careTeamLabel: 'Care team',
          room: admission.bedNumber ? `${admission.wardName} · Bed ${admission.bedNumber}` : admission.wardName,
          locationSecondary: 'Ward',
          date: (admission.admissionDate || today).slice(0, 10),
          patientId: admission.patientId,
          onClick: () => router.push(`/wards/mar/${admission._id}`),
          actionLabel: 'MAR',
          onAction: () => router.push(`/wards/mar/${admission._id}`),
        };
      });
    }

    return patients.filter(patient => hit(
      patientFullName(patient), patient.hospitalNumber, patient.phone,
      patient.county, patient.state, patient.assignedDoctorName,
    )).slice(0, 10).map(patient => {
      const time = rowTime(patientRegisteredAt(patient));
      return {
        id: patient._id,
        photoUrl: (patient as { photoUrl?: string }).photoUrl,
        title: patientFullName(patient),
        subtitle: patientGenderAge(patient),
        meta: `${patient.hospitalNumber || 'No MRN'} · ${patient.phone || 'No phone'} · ${patient.county || 'No location'}`,
        time,
        timeSecondary: (patient.registeredAt || patient.registrationDate || today).slice(0, 10),
        status: patient.assignedDoctor ? 'assigned' : 'needs routing',
        statusLabel: patient.assignedDoctor ? 'Assigned' : 'Needs routing',
        statusSecondary: patient.assignedDoctor ? 'Care team assigned' : 'Needs care team',
        statusTone: patient.assignedDoctor ? 'ready' : 'warning',
        // Already routed to a doctor is "Routine"; still needing routing is "Urgent".
        chartSeries: (patient.assignedDoctor ? 1 : 0) as 0 | 1,
        // Age already reads in the subtitle (patientGenderAge) — it isn't an
        // acuity, so it doesn't belong in the priority pill.
        careTeam: patient.assignedDoctorName || 'Doctor unassigned',
        careTeamSecondary: patient.assignedByName || 'Nurse unassigned',
        careTeamLabel: 'Care team',
        room: patient.county || patient.state,
        locationSecondary: 'Location',
        date: (patient.registeredAt || patient.registrationDate || today).slice(0, 10),
        patientId: patient._id,
        onClick: () => router.push(`/patients/${patient._id}`),
        actionLabel: 'Open',
        onAction: () => router.push(`/patients/${patient._id}`),
      };
    });
  }, [activeAdmissions, activeTab, patients, photoByPatientId, railSearch, router, today, triageToday]);

  const dateLabel = useMemo(() => (
    new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit' }).format(new Date())
  ), []);

  const stationSummary = useMemo(() => {
    if (activeTab === 'triage') {
      return [
        { name: 'Critical', value: criticalTriage, color: CHART_RED },
        { name: 'Urgent', value: urgentTriage, color: CHART_AMBER },
        { name: 'Routine', value: routineTriage, color: CHART_GREEN },
      ];
    }
    if (activeTab === 'rooming') {
      return [
        { name: 'Waiting', value: roomingEntries.filter(entry => entry.step !== 'being_roomed').length, color: CHART_AMBER },
        { name: 'In room', value: roomingEntries.filter(entry => entry.step === 'being_roomed').length, color: CHART_GREEN },
      ];
    }
    if (activeTab === 'mar') {
      return [
        { name: 'Overdue', value: marEntries.filter(entry => entry.status === 'overdue').length, color: CHART_RED },
        { name: 'Due now', value: marEntries.filter(entry => entry.status === 'due').length, color: CHART_AMBER },
        { name: 'Given', value: marEntries.filter(entry => entry.status === 'given').length, color: CHART_GREEN },
      ];
    }
    const critical = activeAdmissions.length > 0
      ? activeAdmissions.filter(admission => admission.severity === 'critical').length
      : IS_DEMO ? DEMO_WARD_PATIENTS.filter(patient => patient._triage?.priority === 'RED').length : 0;
    const urgent = activeAdmissions.length > 0
      ? activeAdmissions.filter(admission => admission.severity === 'severe').length
      : IS_DEMO ? DEMO_WARD_PATIENTS.filter(patient => patient._triage?.priority === 'YELLOW').length : 0;
    const total = activeAdmissions.length > 0 || !IS_DEMO ? activeAdmissions.length : DEMO_WARD_PATIENTS.length;
    return [
      { name: 'Critical', value: critical, color: CHART_RED },
      { name: 'Watch', value: urgent, color: CHART_AMBER },
      { name: 'Stable', value: Math.max(0, total - critical - urgent), color: CHART_GREEN },
    ];
  }, [activeAdmissions, activeTab, marEntries, roomingEntries, criticalTriage, urgentTriage, routineTriage]);
  const stationSummaryTotal = stationSummary.reduce((sum, item) => sum + item.value, 0);

  const metrics = useMemo(() => {
    if (activeTab === 'triage') return [
      { label: 'Waiting', value: waitingTriage, tone: 'warning' as const },
      { label: 'Critical', value: criticalTriage, tone: 'danger' as const },
      { label: 'Completed', value: triageToday.filter(triage => triage.status !== 'pending').length },
    ];
    if (activeTab === 'rooming') return [
      { label: 'Waiting', value: roomingEntries.filter(entry => entry.step !== 'being_roomed').length, tone: 'warning' as const },
      { label: 'In room', value: roomingEntries.filter(entry => entry.step === 'being_roomed').length },
      { label: 'With room', value: roomingEntries.filter(entry => Boolean(entry.encounter.roomNumber)).length },
    ];
    if (activeTab === 'mar') return [
      { label: 'Overdue', value: marEntries.filter(entry => entry.status === 'overdue').length, tone: 'danger' as const },
      { label: 'Due now', value: marEntries.filter(entry => entry.status === 'due').length, tone: 'warning' as const },
      { label: 'Given', value: marEntries.filter(entry => entry.status === 'given').length },
    ];
    const critical = activeAdmissions.length > 0 ? activeAdmissions.filter(admission => admission.severity === 'critical').length : IS_DEMO ? DEMO_WARD_PATIENTS.filter(patient => patient._triage?.priority === 'RED').length : 0;
    const urgent = activeAdmissions.length > 0 ? activeAdmissions.filter(admission => admission.severity === 'severe').length : IS_DEMO ? DEMO_WARD_PATIENTS.filter(patient => patient._triage?.priority === 'YELLOW').length : 0;
    return [
      { label: 'Critical', value: critical, tone: 'danger' as const },
      { label: 'Watch', value: urgent, tone: 'warning' as const },
      { label: 'Admitted', value: wardBoardCount },
    ];
  }, [activeAdmissions, activeTab, marEntries, roomingEntries, waitingTriage, criticalTriage, triageToday, wardBoardCount]);

  const chartTitle = activeTab === 'triage' ? 'Triage activity' : activeTab === 'rooming' ? 'Rooming activity' : activeTab === 'mar' ? 'Medication activity' : 'Ward activity';
  const chartSeriesNames: [string, string] = activeTab === 'triage'
    ? ['Critical', 'Routine']
    : activeTab === 'rooming'
    ? ['Waiting', 'In room']
    : activeTab === 'mar' ? ['Open doses', 'Given'] : ['Acute', 'Stable'];

  if (!currentUser) return null;

  return (
    <>
      <main className="page-container page-enter">
        <EhrCareDashboard
          title={t('nurse.title')}
          eyebrow={roleConfig?.label || 'Nursing'}
          greetingName={currentUser.name || 'nurse'}
          dateLabel={dateLabel}
          // All nursing stations use the same URL-addressable daybar.
          tabs={daybarTabs}
          activeTab={activeTab}
          onTabChange={(tab) => selectStation(tab as StationTab)}
          searchValue={railSearch}
          onSearchChange={setRailSearch}
          searchPlaceholder={t('nurse.searchPatientPlaceholder')}
          filters={[]}
          actions={actions}
          // Meaning shifts with the active station (triage acuity, admission
          // severity, or routing status), so chartSeries is set explicitly per
          // row rather than relying on the done-based default — none of these
          // three stations' rows ever reach a 'done' statusTone.
          chartTitle={chartTitle}
          chartSeriesNames={chartSeriesNames}
          chartItems={chartItems}
          // Triage acuity donut — today's RED/YELLOW/GREEN split, rendered in
          // the left rail directly below the Triage activity chart.
          railContent={(
            <div className="ehr-day-stats">
              <div className="ehr-day-stats-head">
                <h3 className="flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4" style={{ color: CHART_RED }} />
                  {activeTab === 'triage' ? 'Triage acuity' : activeTab === 'rooming' ? 'Rooming queue' : activeTab === 'mar' ? 'Medication doses today' : 'Ward acuity'}
                </h3>
              </div>
              {stationSummaryTotal === 0 ? (
                <p className="ehr-day-stats-empty">No work in this station</p>
              ) : (
                <div className="flex items-center gap-4" style={{ marginTop: 12 }}>
                  <div className="relative flex-shrink-0" style={{ width: 110, height: 110 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={stationSummary} dataKey="value" innerRadius={36} outerRadius={52} paddingAngle={3} stroke="none">
                          {stationSummary.map(d => <Cell key={d.name} fill={d.color} />)}
                        </Pie>
                        <Tooltip {...tooltipStyle} formatter={(v, name) => [v ?? 0, String(name ?? '')]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stationSummaryTotal}</span>
                      <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>in station</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {stationSummary.map(d => (
                      <div key={d.name} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-2 h-2 rounded-full inline-block" style={{ background: d.color }} />
                          {d.name}
                        </span>
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          // The rail search and global module menu already provide patient and
          // cross-service navigation. Keeping a second action strip here made
          // the same destinations appear twice on every nursing station.
          rows={[]}
          // The design's daybar carries only the station title + tabs — the
          // tabs already show each board's count, so no subtitle.
          centerTitle="Nursing station"
          centerSubtitle=""
          metrics={metrics}
          calendarEventDates={activeTab === 'triage'
            ? triageToday.map(triage => (triage.triagedAt || today).slice(0, 10))
            : activeTab === 'rooming'
            ? roomingEntries.map(entry => (entry.encounter.startedAt || entry.encounter.createdAt || today).slice(0, 10))
            : activeTab === 'mar'
              ? [today]
              : activeAdmissions.map(admission => (admission.admissionDate || today).slice(0, 10))}
          metricsTitle={activeTab === 'triage' ? 'Triage today' : activeTab === 'rooming' ? 'Rooming today' : activeTab === 'mar' ? 'Medication today' : 'Ward today'}
          emptyTitle="No patients in this station"
          hideRowList
        >
          <div className="flex flex-col" style={{ minHeight: 0 }}>
            {activeTab === 'triage' && <TriageWorkflow />}
            {activeTab === 'ward' && <WardWorkflow search={railSearch} showHeader={false} />}
            {activeTab === 'mar' && <MarWorkflow />}
            {activeTab === 'rooming' && <RoomingWorkflow />}
          </div>
        </EhrCareDashboard>

        {handoffOpen && (
          <HandoffWorkflow
            variant="modal"
            onClose={() => setHandoffOpen(false)}
          />
        )}

        {printOpen && (
          <PrintListDialog
            title="Print nurse station"
            subtitle={`${dateLabel} — ${currentUser.name || 'Nurse'}`}
            sections={printSections}
            filename={`nurse-station-${today}`}
            onClose={() => setPrintOpen(false)}
          />
        )}
      </main>
    </>
  );
}
