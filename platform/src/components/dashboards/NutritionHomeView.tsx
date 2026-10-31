'use client';

/**
 * The nutritionist's home: the shared clinical workspace (EhrClinicalDashboard,
 * the doctor's dashboard), in nutrition terms.
 *
 * The nutrition station was its own console — a screening list with a "New
 * screening" button and stat toggles. It now works the way a doctor's day
 * does: Book appointment, a worklist of the patients who need the
 * nutritionist, outstanding items, and the record itself made in the patient
 * chart (the chart's Nutrition screening form). Every to-do entry opens that
 * chart with the form already up (`?form=nutrition-screening`).
 *
 * Worklist rows = patients whose latest screening is flagged (SAM / MAM /
 * at risk / underweight) and still needs follow-up, plus the nutritionist's
 * own appointments (the shell adds those).
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Package, Utensils } from '@/components/icons/lucide';
import { useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import NutritionScreeningPanel from '@/components/ehr/chart/panels/NutritionScreeningPanel';
import '@/components/lab/workflow/lab-workflow.css';
import EhrClinicalDashboard, {
  type WorklistPatient,
  type OutstandingItem,
  type OutstandingEntry,
} from '@/components/ehr/EhrClinicalDashboard';
import type { DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useNutritionScreenings } from '@/lib/hooks/useNutritionScreenings';
import { useNutritionSupplies } from '@/lib/hooks/useNutritionSupplies';
import { classifySupplyStatus, type NutritionSupplyDoc } from '@/lib/services/nutrition-supply-service';
import { patientDisplayName, patientAge, shortenPersonName } from '@/lib/patient-utils';
import { appointmentsVisibleToUser } from '@/lib/appointment-visibility';
import { localClockOf, localDayOf, toIsoDate } from '@/lib/date-utils';
import { agoLabel, shortDayLabel } from '@/lib/station-time';
import type { NutritionScreeningDoc, PatientDoc } from '@/lib/db-types';

export const NUTRITION_SUPPLIES_HREF = '/dashboard/nutrition/supplies';

const FLAGGED = new Set(['SAM', 'MAM', 'At Risk', 'Underweight']);

/** Opens the chart with the screening form up. */
export function screeningFormHref(patientId: string): string {
  return `/patients/${encodeURIComponent(patientId)}?form=nutrition-screening`;
}

function needsFollowUp(s: NutritionScreeningDoc): boolean {
  return FLAGGED.has(s.status) && (!s.followUpAction || s.followUpAction === 'needed');
}

export interface NutritionWorklistInput {
  currentUser: { _id: string; name?: string };
  patients: PatientDoc[];
  /** Every screening in scope, newest first (`useNutritionScreenings`). */
  screenings: NutritionScreeningDoc[];
  supplies: NutritionSupplyDoc[];
  labels: { samToTreat: string; followUps: string; supplyAlerts: string; edema: string; assigned: string; muac: (value: number) => string; nextAction?: string };
  now?: Date;
}

export interface NutritionWorklistResult {
  patients: WorklistPatient[];
  outstanding: OutstandingItem[];
  activity: DayStatsItem[];
}

export function assembleNutritionWorklist({
  currentUser, patients, screenings, supplies, labels, now = new Date(),
}: NutritionWorklistInput): NutritionWorklistResult {
  const patientById = new Map(patients.map(p => [p._id, p]));

  // A patient's standing is their LATEST screening: a child screened SAM last
  // month and Normal today is not on the list.
  const latestByPatient = new Map<string, NutritionScreeningDoc>();
  for (const s of screenings) {
    if (s.patientId && !latestByPatient.has(s.patientId)) latestByPatient.set(s.patientId, s);
  }
  const open = [...latestByPatient.values()].filter(needsFollowUp);

  const clockOf = (iso?: string) => (localDayOf(iso) === toIsoDate(now) ? localClockOf(iso) : shortDayLabel(iso));
  const rows: WorklistPatient[] = open.map(s => {
    const doc = patientById.get(s.patientId as string);
    const context = `${s.status} · ${labels.muac(s.muac)}`;
    return {
      _id: s.patientId as string,
      photoUrl: doc?.photoUrl,
      name: doc ? patientDisplayName(doc) : shortenPersonName(s.patientName),
      age: doc ? patientAge(doc) : null,
      gender: doc?.gender?.[0] || s.sex || '',
      id: doc?.hospitalNumber,
      ward: context,
      division: context,
      doctor: currentUser.name || '',
      assignedDoctor: currentUser._id,
      assignedDoctorName: currentUser.name,
      assignmentStatus: 'assigned',
      triagePriority: s.status === 'SAM' ? 'RED' : s.status === 'MAM' ? 'YELLOW' : 'GREEN',
      station: {
        timeLabel: clockOf(s.createdAt),
        timeSubtext: agoLabel(s.createdAt, now),
        context,
        contextSubtext: '',
        status: s.status,
        statusTone: s.status === 'SAM' ? 'danger' : 'warning',
        statusSubtext: '',
        careTeamSecondary: '',
        lane: 'scheduled',
        chartHref: screeningFormHref(s.patientId as string),
        openId: s.patientId as string,
        actions: labels.nextAction ? [{ value: 'next', label: labels.nextAction }] : undefined,
      },
    };
  });

  // And anyone the desk routed here who has no open case yet.
  const today = toIsoDate(now);
  const clock = (iso?: string) => (localDayOf(iso) === today ? localClockOf(iso) : shortDayLabel(iso));
  const assignedToMe = patients.filter(p => p.stationAssignments?.nutrition?.staffId === currentUser._id);
  const listed = new Set(rows.map(row => row._id));
  for (const doc of assignedToMe) {
    if (listed.has(doc._id)) continue;
    const slot = doc.stationAssignments!.nutrition!;
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
        chartHref: screeningFormHref(doc._id),
        openId: doc._id,
        actions: labels.nextAction ? [{ value: 'next', label: labels.nextAction }] : undefined,
      },
    });
  }

  const entry = (s: NutritionScreeningDoc): OutstandingEntry => ({
    id: s._id,
    title: shortenPersonName(s.patientName),
    subtitle: `${s.status} · ${labels.muac(s.muac)}${s.edema ? ` · ${labels.edema}` : ''}`,
    meta: s.screeningDate,
    tone: s.status === 'SAM' ? 'danger' : 'warning',
    href: screeningFormHref(s.patientId as string),
  });
  const sam = open.filter(s => s.status === 'SAM');
  const others = open.filter(s => s.status !== 'SAM');

  const lowStock = supplies
    .map(item => ({ item, status: classifySupplyStatus(item) }))
    .filter(({ status }) => status !== 'ok');

  const outstanding: OutstandingItem[] = [
    {
      label: labels.samToTreat,
      count: sam.length,
      tone: sam.length > 0 ? 'danger' : 'neutral',
      entries: sam.map(entry),
    },
    {
      label: labels.followUps,
      count: others.length,
      tone: others.length > 0 ? 'warning' : 'neutral',
      entries: others.map(entry),
    },
    {
      label: labels.supplyAlerts,
      count: lowStock.length,
      tone: lowStock.some(({ status }) => status === 'critical') ? 'danger' : lowStock.length ? 'warning' : 'neutral',
      href: NUTRITION_SUPPLIES_HREF,
      entries: lowStock.map(({ item, status }) => ({
        id: item._id,
        title: item.name,
        subtitle: `${item.currentLevel} ${item.unit} · reorder at ${item.reorderLevel}`,
        tone: status === 'critical' ? 'danger' as const : 'warning' as const,
        href: NUTRITION_SUPPLIES_HREF,
      })),
    },
    {
      label: labels.assigned,
      count: assignedToMe.length,
      tone: 'neutral',
      entries: assignedToMe.map(p => ({
        id: p._id,
        title: patientDisplayName(p),
        subtitle: p.stationAssignments?.nutrition?.note || p.hospitalNumber,
        meta: clock(p.stationAssignments?.nutrition?.assignedAt),
        tone: 'neutral' as const,
        href: screeningFormHref(p._id),
      })),
    },
  ];

  // Week bars: every screening taken, flagged (series 0) vs normal (series 1)
  // — the nutritionist holds few appointments, so a schedule-derived chart
  // would read "no activity" on a busy screening week.
  const activity: DayStatsItem[] = screenings.map(s => ({
    date: localDayOf(s.createdAt) || s.screeningDate,
    time: s.createdAt ? localClockOf(s.createdAt) : undefined,
    series: (FLAGGED.has(s.status) ? 0 : 1) as 0 | 1,
  }));

  return { patients: rows, outstanding, activity };
}

export default function NutritionHomeView() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const { patients } = usePatients();
  const { appointments } = useAppointments();
  const { screenings } = useNutritionScreenings();
  const { items: supplies } = useNutritionSupplies();
  // Who is open in the screening slider.
  const [screenFor, setScreenFor] = useState<string | null>(null);

  if (!currentUser) return null;

  const worklist = assembleNutritionWorklist({
    currentUser, patients, screenings, supplies,
    labels: {
      samToTreat: t('nutritionHome.samToTreat'),
      followUps: t('nutritionHome.followUps'),
      supplyAlerts: t('nutrition.kpiSupplyAlerts'),
      edema: t('nutritionHome.edema'),
      assigned: t('labHome.assignedToMe'),
      muac: value => t('nutritionForm.muacReading', { value }),
      nextAction: t('nutritionHome.actionScreen'),
    },
  });
  const screenPatient = screenFor ? patients.find(p => p._id === screenFor) : undefined;

  return (
    <main className="page-container page-enter">
      <EhrClinicalDashboard
        clinicianName={currentUser.name || 'nutritionist'}
        patients={worklist.patients}
        appointments={appointmentsVisibleToUser(appointments, currentUser)}
        outstanding={worklist.outstanding}
        activityItems={worklist.activity}
        activitySeriesNames={[t('nutritionHome.flagged'), t('nutrition.kpiNormal')]}
        missionTitle={t('mission.nutrition.title')}
        missionDescription={t('mission.nutrition.body')}
        missionIcon={Utensils}
        extraHeaderActions={[{
          key: 'nutrition-supplies',
          label: t('nutritionHome.supplies'),
          icon: Package,
          run: () => router.push(NUTRITION_SUPPLIES_HREF),
        }]}
        onStationOpen={setScreenFor}
      />
      {screenPatient && (
        <FormSlider title={t('nutritionHome.actionScreen')} subtitle={patientDisplayName(screenPatient)} className="tamam-dialog" width={560} flush onClose={() => setScreenFor(null)}>
          <div className="station-form-slider o3f-scroll">
            <NutritionScreeningPanel patient={screenPatient} currentUser={currentUser} onClose={() => setScreenFor(null)} />
          </div>
        </FormSlider>
      )}
    </main>
  );
}
