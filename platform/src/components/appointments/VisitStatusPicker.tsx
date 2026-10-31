'use client';

/**
 * A visit's status pill as a picker, for screens that list patients rather
 * than visits (the billing work queue). Same pill, same role-filtered rungs and
 * same write path as the worklist dashboards — see useVisitStatusChange —
 * and the same confirm: a pick opens StatusChangeSlider before it is written.
 */

import { useState } from 'react';
import AppointmentStatusPillSelect from './AppointmentStatusPillSelect';
import StatusChangeSlider from './StatusChangeSlider';
import { APPOINTMENT_STATUS_TONES, appointmentStatusNeedsReason } from '@/lib/appointment-status';
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
  const [next, setNext] = useState<AppointmentStatus | null>(null);
  return (
    <>
    <AppointmentStatusPillSelect
      status={status}
      className={TONE_CLASS[APPOINTMENT_STATUS_TONES[status]] || ''}
      ariaLabel={`Status for ${patientName || 'patient'}`}
      role={currentUser?.role}
      labelFor={labelFor}
      onChange={pick => { if (pick !== status) setNext(pick); }}
    />
    {next && (
      <StatusChangeSlider
        patientName={patientName || ''}
        from={status}
        to={next}
        needsReason={appointmentStatusNeedsReason(next)}
        onClose={() => setNext(null)}
        onConfirm={reason => change({ appointmentId, patientName, status }, next, reason)}
      />
    )}
    </>
  );
}
