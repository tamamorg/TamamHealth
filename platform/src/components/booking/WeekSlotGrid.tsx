'use client';

/**
 * WeekSlotGrid — one row per clinician, one column per day.
 *
 * This is how you choose a doctor and a time in a single glance: the rows are
 * the people, the columns are the days, and the cells are what each of them has
 * free. A flat list of times cannot do that — it repeats "9:00 AM" once per
 * clinician and leaves the reader to work out whose is whose.
 *
 * A cell shows a few openings and then a "+N more" that expands in place, so a
 * doctor with twenty free slots does not push the next doctor off the screen.
 * A day with nothing shows dashes — one per rank of the row, on the same line
 * rhythm as the chips beside them — so a clinician who is off on Wednesday is
 * a fact stated in line, not a blank to squint at.
 *
 * Visual language (chips, dashes, nav) lives in globals.css under the `bwg-`
 * namespace, on a fixed 30px line rhythm so chips align horizontally across
 * every column of a row.
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Video } from '@/components/icons/lucide';
import StaffAvatar from '@/components/staff/StaffAvatar';
import type { Slot } from '@/lib/booking/slot-engine';
import { addDays, datesBetween } from '@/lib/booking/slot-engine';
import { to12Hour, dayParts } from './SlotPicker';

export interface GridProvider {
  providerId: string;
  providerName: string;
  /** Shown under the name, e.g. "Internal Medicine". */
  subtitle?: string;
  photoUrl?: string;
}

export default function WeekSlotGrid({
  slots,
  providers,
  startDate,
  onStartDateChange,
  onPick,
  selected,
  loading = false,
  days = 5,
  maxPerCell = 3,
  minDate,
}: {
  slots: Slot[];
  /** Rows to draw, in order. A provider with no slots still gets a row. */
  providers: GridProvider[];
  startDate: string;
  onStartDateChange: (date: string) => void;
  onPick: (slot: Slot) => void;
  selected?: { providerId: string; date: string; startTime: string };
  loading?: boolean;
  days?: number;
  maxPerCell?: number;
  minDate?: string;
}) {
  const columns = useMemo(
    () => datesBetween(startDate, addDays(startDate, days - 1)),
    [startDate, days],
  );

  // providerId → date → slots
  const byProvider = useMemo(() => {
    const map = new Map<string, Map<string, Slot[]>>();
    for (const slot of slots) {
      let byDate = map.get(slot.providerId);
      if (!byDate) { byDate = new Map(); map.set(slot.providerId, byDate); }
      const list = byDate.get(slot.date);
      if (list) list.push(slot);
      else byDate.set(slot.date, [slot]);
    }
    return map;
  }, [slots]);

  // Only draw clinicians who have something in the loaded range — a row of
  // five dashes teaches nothing and pushes the real options down.
  const rows = useMemo(
    () => providers.filter(p => byProvider.has(p.providerId)),
    [providers, byProvider],
  );

  const canGoBack = !minDate || startDate > minDate;

  return (
    <div className="booking-week-grid">
      {/* ── Day header ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(210px, 1.5fr) repeat(${columns.length}, minmax(76px, 1fr))`,
          alignItems: 'center',
          gap: 10,
          // The date strip is what the reader steers the whole grid by, so it
          // gets the weight of a heading rather than of a caption — and hugs
          // it, rather than sitting in a band of empty space twice its height.
          padding: '0 0 8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingInlineEnd: 4 }}>
          <NavButton
            direction="back"
            disabled={!canGoBack || loading}
            onClick={() => onStartDateChange(addDays(startDate, -days))}
            label="Previous days"
          />
        </div>
        {columns.map((date, index) => {
          const { weekday, label } = dayParts(date);
          return (
            <div key={date} style={{ textAlign: 'center', position: 'relative' }}>
              <div style={{
                fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
                color: 'var(--text-muted)', marginBottom: 2,
              }}>
                {weekday}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.15 }}>
                {label}
              </div>
              {index === columns.length - 1 && (
                <div style={{ position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)' }}>
                  <NavButton
                    direction="forward"
                    disabled={loading}
                    onClick={() => onStartDateChange(addDays(startDate, days))}
                    label="Next days"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Rows ── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '32px 0', color: 'var(--text-muted)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span style={{ fontSize: 13 }}>Checking availability…</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 8px' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            No clinician has openings in these days.
          </p>
          <button
            type="button"
            className="bwg-slot"
            onClick={() => onStartDateChange(addDays(startDate, days))}
            style={{ marginTop: 10, width: 'auto', maxWidth: 'none', padding: '0 16px' }}
          >
            Look at the next {days} days
          </button>
        </div>
      ) : (
        rows.map(provider => (
          <ProviderRow
            key={provider.providerId}
            provider={provider}
            columns={columns}
            slotsByDate={byProvider.get(provider.providerId) ?? new Map()}
            onPick={onPick}
            selected={selected}
            maxPerCell={maxPerCell}
          />
        ))
      )}
    </div>
  );
}

function ProviderRow({
  provider, columns, slotsByDate, onPick, selected, maxPerCell,
}: {
  provider: GridProvider;
  columns: string[];
  slotsByDate: Map<string, Slot[]>;
  onPick: (slot: Slot) => void;
  selected?: { providerId: string; date: string; startTime: string };
  maxPerCell: number;
}) {
  // Expansion is per cell, not per row: opening Wednesday should not stretch
  // every other day of the same doctor.
  const [expanded, setExpanded] = useState<string | null>(null);
  const isTelehealth = [...slotsByDate.values()].flat().some(s => s.modality === 'telehealth');

  // Collapsed line count of the row's busiest day. Empty days print this many
  // dashes on the same line rhythm as the chips, so each rank of times rules
  // straight across the week instead of a lone dash floating at the top.
  // Collapsed on purpose: expanding one day should not grow the dash stacks.
  const baseLines = Math.max(1, ...columns.map(date => {
    const n = slotsByDate.get(date)?.length ?? 0;
    if (n === 0) return 0;
    return Math.min(n, maxPerCell) + (n > maxPerCell ? 1 : 0);
  }));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `minmax(210px, 1.5fr) repeat(${columns.length}, minmax(76px, 1fr))`,
        gap: 10,
        // Top, not centre. The row's height is set by its busiest day, so
        // centring floated the name level with whatever chip happened to be in
        // the middle. Aligned to the top it reads against the clinician's FIRST
        // opening, which is the one the eye goes to.
        alignItems: 'start',
        // No rule between rows: the whitespace and the avatar already separate
        // one clinician from the next, and three hairlines across a grid that
        // is itself all boxes just added noise.
        padding: '10px 0 14px',
      }}
    >
      {/* Clinician */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingTop: 2 }}>
        <StaffAvatar name={provider.providerName} photoUrl={provider.photoUrl} size={44} rounded="card" />
        <div style={{ minWidth: 0 }}>
          {/* Wrapped, not truncated. "CO Deng Mabior K…" and "Dr. Achol Mayen
              De…" are the same nine characters for two different people —
              which is exactly the distinction this column exists to make. */}
          <div style={{
            fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
            lineHeight: 1.3, overflowWrap: 'anywhere',
          }}>
            {provider.providerName}
          </div>
          {provider.subtitle && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35 }}>
              {provider.subtitle}
            </div>
          )}
          {isTelehealth && (
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3,
                padding: '2px 8px', fontSize: 11, fontWeight: 600,
                background: 'var(--accent-light)', color: 'var(--accent-primary)',
              }}
            >
              <Video className="w-3 h-3" /> Virtual visit
            </span>
          )}
        </div>
      </div>

      {/* One cell per day */}
      {columns.map(date => {
        const daySlots = slotsByDate.get(date) ?? [];
        const isOpen = expanded === date;
        const shown = isOpen ? daySlots : daySlots.slice(0, maxPerCell);
        const hidden = daySlots.length - shown.length;

        if (daySlots.length === 0) {
          return (
            <div key={date} className="bwg-cell">
              {Array.from({ length: baseLines }, (_, i) => (
                <span key={i} className="bwg-dash" aria-hidden>—</span>
              ))}
            </div>
          );
        }

        return (
          <div key={date} className="bwg-cell">
            {shown.map(slot => {
              const isSelected = selected
                && selected.providerId === slot.providerId
                && selected.date === slot.date
                && selected.startTime === slot.startTime;
              return (
                <button
                  key={slot.startTime}
                  type="button"
                  className={isSelected ? 'bwg-slot bwg-slot--selected' : 'bwg-slot'}
                  onClick={() => onPick(slot)}
                >
                  {to12Hour(slot.startTime)}
                </button>
              );
            })}
            {(hidden > 0 || isOpen) && (
              // Same chip as the slots it reveals. Dashed-and-muted read as
              // disabled — the one chip in the cell that looked unavailable
              // was the one that opens the rest.
              <button
                type="button"
                className="bwg-slot"
                onClick={() => setExpanded(isOpen ? null : date)}
              >
                {isOpen ? 'less' : `+${hidden} more`}
              </button>
            )}
          </div>
        );
      })}
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
      className="bwg-nav"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
