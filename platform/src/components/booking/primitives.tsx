'use client';

/**
 * The small, shared pieces of the booking UI.
 *
 * All of them are presentational and prop-driven, because the same controls
 * appear in three different frames: the right rail of a provider profile, the
 * full-width practice page, and a chrome-less embed on a practice's own
 * website. Anything that reached for context or a router would only work in
 * one of the three.
 */

import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, MapPin, Phone } from '@/components/icons/lucide';
import { dayParts, monogram, to12Hour } from '@/lib/booking/public-client';

// ── Card shell ─────────────────────────────────────────────────────────────

export function BookingCard({
  title, onBack, onClose, children, headless = false,
}: {
  title?: string;
  onBack?: () => void;
  onClose?: () => void;
  children: ReactNode;
  headless?: boolean;
}) {
  return (
    <section className="booking-card">
      {!headless && title && (
        <header className="booking-card-head">
          {onBack && (
            <button type="button" className="booking-card-back" onClick={onBack} aria-label="Back">
              <ChevronLeft size={20} />
            </button>
          )}
          <span>{title}</span>
          {onClose && (
            <button type="button" className="booking-card-close" onClick={onClose} aria-label="Close">
              <span aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>×</span>
            </button>
          )}
        </header>
      )}
      <div className="booking-card-body">{children}</div>
    </section>
  );
}

// ── New / returning ────────────────────────────────────────────────────────

/**
 * The reference uses two different controls for the same question: a segmented
 * pair on the provider rail, a checkbox on the practice page. One component
 * with a `variant` keeps the *meaning* in one place — which matters, because
 * this answer decides which visit reasons and which availability windows the
 * patient is even shown.
 */
export function PatientClassToggle({
  value, onChange, variant = 'segmented', disabled = false,
}: {
  value: 'new' | 'returning';
  onChange: (next: 'new' | 'returning') => void;
  variant?: 'segmented' | 'checkbox';
  disabled?: boolean;
}) {
  if (variant === 'checkbox') {
    return (
      <label className="booking-check">
        <input
          type="checkbox"
          checked={value === 'new'}
          disabled={disabled}
          onChange={e => onChange(e.target.checked ? 'new' : 'returning')}
        />
        <span>I&rsquo;m a new patient at this practice</span>
      </label>
    );
  }
  return (
    <div className="booking-segmented" role="group" aria-label="New or returning patient">
      {(['new', 'returning'] as const).map(k => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          aria-pressed={value === k}
          className={value === k ? 'is-active' : undefined}
          onClick={() => onChange(k)}
        >
          {k === 'new' ? 'New patient' : 'Returning patient'}
        </button>
      ))}
    </div>
  );
}

// ── Fields ─────────────────────────────────────────────────────────────────

export function Field({
  label, htmlFor, children, hint,
}: {
  label: string; htmlFor?: string; children: ReactNode; hint?: string;
}) {
  return (
    <div className="booking-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="booking-hint">{hint}</p>}
    </div>
  );
}

/**
 * A native `<select>` with our own chevron.
 *
 * Deliberately native rather than the app's searchable `Select`: that
 * component styles itself from the `ehr-*` cascade this namespace is outside
 * of, and on a patient's phone the OS picker is the better control anyway.
 */
export function BookingSelect({
  id, value, onChange, disabled, children, ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className="booking-select-wrap">
      <select
        id={id}
        className="booking-select"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)}
      >
        {children}
      </select>
      <ChevronDown size={18} />
    </div>
  );
}

// ── Day navigator ──────────────────────────────────────────────────────────

export function DayNavigator({
  date, onPrev, onNext, canGoBack, canGoForward,
}: {
  date: string;
  onPrev: () => void;
  onNext: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const { weekday, label } = dayParts(date);
  return (
    <div className="booking-daynav">
      <button
        type="button" className="booking-round-btn" onClick={onPrev}
        disabled={!canGoBack} aria-label="Previous day"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="booking-daynav-label">
        <small>{weekday}</small>
        <b>{label}</b>
      </div>
      <button
        type="button" className="booking-round-btn" onClick={onNext}
        disabled={!canGoForward} aria-label="Next day"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

// ── Slot chips ─────────────────────────────────────────────────────────────

export function SlotChips({
  times, selected, onPick, emptyNote = 'No times available on this day.',
}: {
  times: string[];
  selected?: string;
  onPick: (time: string) => void;
  emptyNote?: string;
}) {
  if (times.length === 0) return <p className="booking-empty-note">{emptyNote}</p>;
  return (
    <div className="booking-slot-grid">
      {times.map(t => (
        <button
          key={t}
          type="button"
          className={`booking-slot${selected === t ? ' is-selected' : ''}`}
          onClick={() => onPick(t)}
        >
          {to12Hour(t)}
        </button>
      ))}
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────

export function ProviderAvatar({ name, photoUrl, className = 'booking-avatar' }: {
  name: string; photoUrl?: string; className?: string;
}) {
  return (
    <span className={className} aria-hidden>
      {photoUrl
        // A published photo is a URL an admin typed in; if it 404s the
        // monogram behind it is what shows, which is why it is rendered as a
        // child rather than a background-image.
        ? <img src={photoUrl} alt="" loading="lazy" />
        : monogram(name)}
    </span>
  );
}

// ── Step dots ──────────────────────────────────────────────────────────────

export function StepDots({ count, active }: { count: number; active: number }) {
  return (
    <div className="booking-dots" aria-label={`Step ${active + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i === active ? 'is-active' : undefined} />
      ))}
    </div>
  );
}

// ── Call-now card (S1) ─────────────────────────────────────────────────────

export function CallNowCard({ practiceName, phone }: { practiceName: string; phone?: string }) {
  if (!phone) return null;
  return (
    <section className="booking-card" style={{ marginTop: 16 }}>
      <div className="booking-card-body">
        <b style={{ fontSize: 16 }}>Got questions for {practiceName}?</b>
        <a className="booking-btn" href={`tel:${phone.replace(/\s+/g, '')}`}>
          <Phone size={16} aria-hidden /> Call now
        </a>
      </div>
    </section>
  );
}

export function LocationLine({ name, town, state }: { name: string; town?: string; state?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <MapPin size={14} aria-hidden />
      {[name, town, state].filter(Boolean).join(', ')}
    </span>
  );
}
