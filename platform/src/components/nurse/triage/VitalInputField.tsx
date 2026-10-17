'use client';

import { type TriageVitalField, type TriageVitalWarning } from '@/lib/clinical/vitals';
import { UNMEASURED_VITAL_REASONS } from './constants';
import Select from '@/components/Select';

export function VitalInputField({
  field,
  label,
  value,
  placeholder,
  inputMode,
  error,
  warning,
  onChange,
  unmeasuredReason,
  onUnmeasuredReasonChange,
}: {
  field: TriageVitalField;
  label: string;
  value: string;
  placeholder: string;
  inputMode: 'numeric' | 'decimal';
  error?: string;
  warning?: TriageVitalWarning;
  onChange: (value: string) => void;
  /** Set once the nurse has flagged this vital as not captured this visit —
   *  see UNMEASURED_VITAL_REASONS. `undefined` means "captured normally". */
  unmeasuredReason?: string;
  onUnmeasuredReasonChange: (reason: string | undefined) => void;
}) {
  const message = error || warning?.message;
  const messageId = `triage-vital-${field}-message`;
  const tone = error || warning?.urgency === 'RED' ? 'var(--color-danger)' : 'var(--color-warning)';
  const isUnmeasured = unmeasuredReason !== undefined;

  return (
    <div data-vital-field={field}>
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={`triage-vital-${field}`} className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>
          {label}
        </label>
        <button
          type="button"
          onClick={() => onUnmeasuredReasonChange(isUnmeasured ? undefined : UNMEASURED_VITAL_REASONS[0][0])}
          className="text-[8px] font-semibold uppercase tracking-wide"
          style={{ color: isUnmeasured ? 'var(--color-warning)' : 'var(--text-muted)' }}
          title="Record why this vital could not be measured"
        >
          {isUnmeasured ? 'Not taken' : 'N/A'}
        </button>
      </div>
      <input
        id={`triage-vital-${field}`}
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={isUnmeasured}
        aria-invalid={Boolean(error)}
        aria-describedby={message ? messageId : undefined}
        style={{
          width: '100%',
          padding: '5px 8px',
          borderRadius: 6,
          fontSize: 12,
          background: isUnmeasured ? 'var(--overlay-subtle)' : 'var(--bg-card)',
          border: `1px solid ${message ? tone : 'var(--border-light)'}`,
          color: 'var(--text-primary)',
        }}
      />
      {isUnmeasured && (
        <Select
          aria-label={`Reason ${label} was not measured`}
          value={unmeasuredReason}
          onChange={event => onUnmeasuredReasonChange(event.target.value)}
          style={{ width: '100%', marginTop: 4, padding: '3px 6px', borderRadius: 6, fontSize: 10, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
        >
          {UNMEASURED_VITAL_REASONS.map(([code, reasonLabel]) => <option key={code} value={code}>{reasonLabel}</option>)}
        </Select>
      )}
      {message && (
        <p id={messageId} role={error ? 'alert' : 'status'} className="mt-1 text-[9px] leading-tight font-medium" style={{ color: tone }}>
          {error || `${warning?.urgency}: ${warning?.message}`}
        </p>
      )}
    </div>
  );
}
