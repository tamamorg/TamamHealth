'use client';

/**
 * The status pill that IS the picker — one implementation for every worklist
 * row (doctor dashboard, appointments page), so the two can't drift again.
 *
 * The pill keeps its tint and label; the real <select> is laid transparently
 * over it as the hit target (styling in globals.css under
 * `.appointment-status-pill--select`). Options are filtered by the viewer's
 * role through the same lists `updateAppointmentStatus` enforces, so the
 * dropdown never offers a rung the service would silently refuse — a role
 * with no options at all gets the plain read-only pill. When the current
 * status is outside the role's choices (a doctor looking at a still-Scheduled
 * booking), it leads the list disabled so the control reads correctly.
 */

import { appointmentStatusLabel, appointmentStatusOptionsForRole, canonicalAppointmentStatus, APPOINTMENT_STATUS_DESCRIPTIONS } from '@/lib/appointment-status';
import type { AppointmentStatus, UserRole } from '@/lib/db-types';
import { stopsClickPropagation } from '@/lib/a11y';

interface AppointmentStatusPillSelectProps {
  status: AppointmentStatus;
  /** Tone/status class for the pill (e.g. `status-scheduled`). */
  className?: string;
  ariaLabel: string;
  /** Viewer's role — decides which statuses are offered (none = plain pill). */
  role?: UserRole;
  /** Label override so i18n'd surfaces stay translated. */
  labelFor?: (status: AppointmentStatus) => string;
  onChange: (next: AppointmentStatus) => void | Promise<void>;
}

export default function AppointmentStatusPillSelect({
  status, className = '', ariaLabel, role, labelFor = appointmentStatusLabel, onChange,
}: AppointmentStatusPillSelectProps) {
  const choices = appointmentStatusOptionsForRole(role);
  const current = canonicalAppointmentStatus(status);

  if (choices.length === 0) {
    return <span className={`appointment-status-pill ${className}`.trim()}>{labelFor(status)}</span>;
  }

  return (
    // The interactive element here is the native <select> below; this span
    // only stops the row underneath from also handling the click and keys.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      className={`appointment-status-pill appointment-status-pill--select ${className}`.trim()}
      {...stopsClickPropagation}
      onKeyDown={event => event.stopPropagation()}
    >
      {labelFor(status)}
      <select
        value={current}
        aria-label={ariaLabel}
        title={APPOINTMENT_STATUS_DESCRIPTIONS[status]}
        onChange={event => {
          event.stopPropagation();
          const next = event.target.value as AppointmentStatus;
          // A native <select> matches :focus-visible even for a mouse pick,
          // so the pill kept its keyboard focus ring after every selection
          // until the next click landed somewhere else. The ring's job ends
          // with the choice; keyboard users tabbing through still get it.
          event.target.blur();
          if (next !== current) void onChange(next);
        }}
      >
        {!choices.includes(current) && (
          <option value={current} disabled>{labelFor(current)}</option>
        )}
        {choices.map(option => (
          <option key={option} value={option}>{labelFor(option)}</option>
        ))}
      </select>
    </span>
  );
}
