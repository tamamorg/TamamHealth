'use client';

/**
 * The appointment status dropdown — the front desk's whole ladder in one
 * control: Scheduled, Reminder Sent, Confirmed, Arrived, Checked In, Roomed,
 * Checked Out, then the exits (No Show, Rescheduled, Cancelled).
 *
 * Shared so the front desk, the appointments list and the chart all offer the
 * same options in the same order — the drift this replaces had one surface
 * calling a rung "In Progress" while another called it "Roomed", and two
 * surfaces offering no way to set most rungs at all.
 *
 * Options and order come from `APPOINTMENT_STATUS_OPTIONS`. A status not on
 * that list (`requested`, written by the patient portal) is still shown while
 * it is the current value, so the control never misreports where a booking is.
 *
 * Permission is the caller's job, not this component's: it doesn't know which
 * role is driving it, so it can't decide who may reach `cancelled` versus who
 * may only advance the ladder. Pass `allowedStatuses` to narrow the list (the
 * current value always stays visible even if it's outside that list, same as
 * the `requested` handling above); omit it to offer the full ladder.
 */
import { useState } from 'react';
import { APPOINTMENT_STATUS_OPTIONS, APPOINTMENT_STATUS_DESCRIPTIONS, appointmentStatusLabel, canonicalAppointmentStatus } from '@/lib/appointment-status';
import type { AppointmentStatus } from '@/lib/db-types';
import { CalendarClock } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function AppointmentStatusSelect({
  status,
  disabled,
  onChange,
  layout = 'row',
  label = 'Appointment status',
  allowedStatuses,
}: {
  status: AppointmentStatus;
  disabled?: boolean;
  /** May route instead of writing (e.g. check-in opens its own dialog). */
  onChange: (status: AppointmentStatus) => Promise<void> | void;
  /** 'row' gives the labelled line used in a row's expanded detail; 'bare' is
   *  just the select, for an actions strip that already has its own labels. */
  layout?: 'row' | 'bare';
  label?: string;
  /** Narrows the offered rungs to this set (see module doc above). */
  allowedStatuses?: AppointmentStatus[];
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const base = allowedStatuses
    ? APPOINTMENT_STATUS_OPTIONS.filter(option => allowedStatuses.includes(option))
    : APPOINTMENT_STATUS_OPTIONS;
  // A fine-grained stored status (confirmed, arrived, triaged…) is shown as
  // the simplified rung it folds into rather than being prepended as an extra
  // option — otherwise the list would offer "Scheduled" twice. Only a status
  // whose canonical rung is ALSO absent (requested) still gets prepended, so
  // the control never misreports where a booking is.
  const canonical = canonicalAppointmentStatus(status);
  const shownValue = base.includes(status) ? status : base.includes(canonical) ? canonical : status;
  const options = shownValue === status && !base.includes(status) ? [status, ...base] : base;

  // Deliberately the native control, not the searchable Select: the ladder is
  // a short fixed list read at a glance, and a filter box in front of it is
  // noise rather than help.
  const select = (
    <select
      value={shownValue}
      disabled={disabled || saving}
      aria-label={label}
      // Hovering the control explains the CURRENT (stored) status; hovering an
      // option (desktop browsers) explains that rung — this is where "booked
      // vs patient-confirmed" gets settled without leaving the row.
      title={APPOINTMENT_STATUS_DESCRIPTIONS[status]}
      onChange={async (event) => {
        const next = event.target.value as AppointmentStatus;
        // Re-picking the displayed rung is a no-op — it must not quietly
        // downgrade a confirmed booking to plain scheduled.
        if (next === shownValue) return;
        setSaving(true);
        try { await onChange(next); } finally { setSaving(false); }
      }}
    >
      {options.map(option => (
        <option key={option} value={option} title={APPOINTMENT_STATUS_DESCRIPTIONS[option]}>
          {appointmentStatusLabel(option)}
        </option>
      ))}
    </select>
  );

  if (layout === 'bare') return select;

  return (
    <div className="ehr-care-rooming">
      <CalendarClock className="w-4 h-4" />
      <span>{label}</span>
      {select}
      {saving && <span>{t('noteEditor.saving')}</span>}
    </div>
  );
}
