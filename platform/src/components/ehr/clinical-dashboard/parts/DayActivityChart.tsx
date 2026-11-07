'use client';

import { useMemo } from 'react';
import type { AppointmentDoc, AppointmentStatus } from '@/lib/db-types';
import { EhrWeekActivityChart, type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';

/* ─── Day activity chart (left rail) ───
   Maps the clinician's own (provider/location-filtered) schedule onto the
   weekly `EhrWeekActivityChart`: Inpatient (the patient holds an active ward
   admission) vs Outpatient (everyone else). Cancelled and no-show visits are
   excluded, so the bars stay a truthful picture of the doctor's week. */
const CHART_HIDDEN_STATUSES: AppointmentStatus[] = ['cancelled', 'no_show'];

export function DayActivityChart({ appointments, items: providedItems, seriesNames, selectedDate, todayIso, admittedPatientIds, onSelectDate }: {
  appointments: AppointmentDoc[]; selectedDate: string; todayIso: string; admittedPatientIds: Set<string>;
  /** Pre-computed bars for roles whose week isn't a schedule (see the prop
   *  of the same name on EhrClinicalDashboard). */
  items?: DayStatsItem[];
  seriesNames?: [string, string];
  onSelectDate?: (iso: string) => void;
}) {
  const scheduleItems = useMemo<DayStatsItem[]>(() => appointments
    .filter(appointment => !CHART_HIDDEN_STATUSES.includes(appointment.status))
    .map(appointment => ({
      date: appointment.appointmentDate,
      time: appointment.appointmentTime,
      series: admittedPatientIds.has(appointment.patientId) ? 0 : 1,
    })), [appointments, admittedPatientIds]);

  return (
    <EhrWeekActivityChart
      items={providedItems ?? scheduleItems}
      seriesNames={seriesNames ?? ['Inpatient', 'Outpatient']}
      selectedDate={selectedDate}
      todayIso={todayIso}
      onSelectDate={onSelectDate}
    />
  );
}
