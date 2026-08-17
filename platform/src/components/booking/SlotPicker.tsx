'use client';

/**
 * SlotPicker — a day navigator over a grid of bookable times.
 *
 * The times shown are computed from provider availability, not typed into a
 * dropdown, so a slot on this grid is one the booking guard will accept. That
 * is the whole point: the previous booking form offered every half hour from
 * 07:00 to 18:30 whether or not anyone was working, and the clash was only
 * discovered on save.
 *
 * A day with no openings renders as an explicit empty state rather than an
 * empty grid, and a lunch gap is simply absent — there is no fixed grid with
 * holes punched in it.
 */

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from '@/components/icons/lucide';
import type { Slot } from '@/lib/booking/slot-engine';
import { addDays } from '@/lib/booking/slot-engine';

/** "09:30" → "9:30 AM". The patient-facing clock, matching the chips. */
export function to12Hour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const meridiem = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${meridiem}`;
}

/** "2026-08-10" → { weekday: "MON", label: "Aug 10" }. */
export function dayParts(date: string): { weekday: string; label: string } {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: utc.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(),
    label: utc.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

export default function SlotPicker({
  slots,
  date,
  onDateChange,
  onPick,
  selectedStartTime,
  loading = false,
  minDate,
  maxDate,
  columns = 4,
  showProvider = false,
}: {
  /** Slots for the whole loaded range; this component filters to `date`. */
  slots: Slot[];
  date: string;
  onDateChange: (date: string) => void;
  onPick: (slot: Slot) => void;
  /** Highlights the chosen chip when the caller is holding a selection. */
  selectedStartTime?: string;
  loading?: boolean;
  minDate?: string;
  maxDate?: string;
  columns?: number;
  /** Label each chip with the clinician — for an any-provider search. */
  showProvider?: boolean;
}) {
  const daySlots = useMemo(
    () => slots.filter(s => s.date === date),
    [slots, date],
  );

  /** The next day in either direction that actually has something. */
  const jump = (direction: -1 | 1) => {
    const candidates = [...new Set(slots.map(s => s.date))]
      .filter(d => (direction === 1 ? d > date : d < date))
      .sort();
    const next = direction === 1 ? candidates[0] : candidates[candidates.length - 1];
    onDateChange(next ?? addDays(date, direction));
  };

  const canGoBack = !minDate || date > minDate;
  const canGoForward = !maxDate || date < maxDate;
  const { weekday, label } = dayParts(date);

  return (
    <div className="booking-slot-picker">
      {/* ── Day navigator ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <NavButton
          direction="back"
          disabled={!canGoBack || loading}
          onClick={() => jump(-1)}
          label="Previous day with openings"
        />
        <div style={{ textAlign: 'center', lineHeight: 1.25 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            {weekday}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
        </div>
        <NavButton
          direction="forward"
          disabled={!canGoForward || loading}
          onClick={() => jump(1)}
          label="Next day with openings"
        />
      </div>

      {/* ── Slot grid ── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '28px 0', color: 'var(--text-muted)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span style={{ fontSize: 13 }}>Checking availability…</span>
        </div>
      ) : daySlots.length === 0 ? (
        <EmptyDay onNext={() => jump(1)} hasLater={slots.some(s => s.date > date)} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: 8,
          }}
        >
          {daySlots.map(slot => {
            const selected = selectedStartTime === slot.startTime;
            return (
              <button
                key={`${slot.providerId}-${slot.startTime}`}
                type="button"
                onClick={() => onPick(slot)}
                title={showProvider ? `${to12Hour(slot.startTime)} with ${slot.providerName}` : undefined}
                style={{
                  padding: '9px 4px',
                  borderRadius: 999,
                  border: `1px solid ${selected ? 'var(--accent-primary)' : 'var(--border-medium)'}`,
                  background: selected ? 'var(--accent-primary)' : 'var(--bg-card-solid)',
                  color: selected ? '#fff' : 'var(--accent-primary)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'background 120ms ease, border-color 120ms ease',
                }}
              >
                {to12Hour(slot.startTime)}
                {showProvider && (
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 500 }}>
                    {slot.providerName}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavButton({
  direction, disabled, onClick, label,
}: {
  direction: 'back' | 'forward';
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  const Icon = direction === 'back' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 32, height: 32, borderRadius: 999,
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-card-solid)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        flexShrink: 0,
      }}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

/**
 * A day with nothing on it.
 *
 * Says why and offers the next day that does have openings, because "no times"
 * with no way forward is where a patient gives up and phones instead.
 */
function EmptyDay({ onNext, hasLater }: { onNext: () => void; hasLater: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '22px 8px' }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
        No appointments available on this day.
      </p>
      {hasLater && (
        <button
          type="button"
          onClick={onNext}
          style={{
            marginTop: 10,
            padding: '7px 14px',
            borderRadius: 999,
            border: '1px solid var(--border-medium)',
            background: 'transparent',
            color: 'var(--accent-primary)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Go to next available day
        </button>
      )}
    </div>
  );
}
