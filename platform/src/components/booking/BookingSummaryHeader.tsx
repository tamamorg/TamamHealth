'use client';

/**
 * BookingSummaryHeader — what has been chosen, carried into every later step.
 *
 * Once a slot is picked, the rest of the flow is about the patient, not the
 * time. Restating the clinician, the day and the hour at the top of each step
 * is what lets someone fill in a form without holding the appointment in their
 * head — and what makes a wrong slot obvious before it is booked rather than
 * after.
 */

import { MapPin } from '@/components/icons/lucide';
import { initials } from '@/lib/patient-utils';
import { to12Hour } from './SlotPicker';

/** "2026-08-10" + "09:00" → "Monday, August 10, 9:00 AM". */
export function formatSlotMoment(date: string, startTime: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  return `${day}, ${to12Hour(startTime)}`;
}

export default function BookingSummaryHeader({
  providerName,
  date,
  startTime,
  durationMinutes,
  facilityName,
  photoUrl,
  onChange,
}: {
  providerName: string;
  date: string;
  startTime: string;
  durationMinutes?: number;
  facilityName?: string;
  photoUrl?: string;
  /** Jump back to the slot step. Omit to render the header as plain text. */
  onChange?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 12,
        border: '1px solid var(--border-medium)', background: 'var(--overlay-subtle)',
      }}
    >
      <div
        style={{
          width: 42, height: 42, borderRadius: 999, flexShrink: 0,
          background: 'var(--accent-light)', color: 'var(--accent-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700,
          backgroundImage: photoUrl ? `url(${photoUrl})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }}
      >
        {!photoUrl && initials(providerName || '?')}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {formatSlotMoment(date, startTime)}
        </div>
        <div
          className="truncate"
          style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {providerName || 'Unassigned'}
          {durationMinutes ? ` · ${durationMinutes} min` : ''}
          {facilityName ? (
            <><MapPin className="w-3 h-3" /> {facilityName}</>
          ) : null}
        </div>
      </div>

      {onChange && (
        <button
          type="button"
          onClick={onChange}
          style={{
            flexShrink: 0, padding: '6px 12px', borderRadius: 999,
            border: '1px solid var(--border-medium)', background: 'var(--bg-card-solid)',
            color: 'var(--accent-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Change
        </button>
      )}
    </div>
  );
}

/** The `○ ● ○` progress dots at the foot of the flow. */
export function BookingStepDots({ step, total }: { step: number; total: number }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
      role="progressbar"
      aria-valuenow={step + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={`Step ${step + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: i === step ? 9 : 7,
            height: i === step ? 9 : 7,
            borderRadius: 999,
            background: i === step ? 'var(--accent-primary)' : 'var(--border-medium)',
            transition: 'width 120ms ease, height 120ms ease',
          }}
        />
      ))}
    </div>
  );
}
