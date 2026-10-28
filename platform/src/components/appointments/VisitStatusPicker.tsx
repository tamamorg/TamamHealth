'use client';

/**
 * A visit's status pill as a picker, for screens that list patients rather
 * than visits (the billing work queue). Same pill, same role-filtered rungs and
 * same write path as the worklist dashboards — see useVisitStatusChange.
 */

import AppointmentStatusPillSelect from './AppointmentStatusPillSelect';
import { APPOINTMENT_STATUS_TONES } from '@/lib/appointment-status';
import type { AppointmentStatus } from '@/lib/db-types';
import { useAuth } from '@/lib/context';
import { useVisitStatusChange } from '@/lib/hooks/useVisitStatusChange';

const TONE_CLASS: Record<string, string> = {
  done: 'status-completed',
  active: 'status-checked-in',
  ready: 'status-confirmed',
  danger: 'status-no-show',
  warning: 'status-attention',
  scheduled: 'status-scheduled',
};

export default function VisitStatusPicker({ appointmentId, status, patientName }: {
  appointmentId: string;
  status: AppointmentStatus;
  patientName?: string;
}) {
  const { currentUser } = useAuth();
  const { change, labelFor } = useVisitStatusChange();
  return (
    <AppointmentStatusPillSelect
      status={status}
      className={TONE_CLASS[APPOINTMENT_STATUS_TONES[status]] || ''}
      ariaLabel={`Status for ${patientName || 'patient'}`}
      role={currentUser?.role}
      labelFor={labelFor}
      onChange={next => { void change({ appointmentId, patientName, status }, next); }}
    />
  );
}
