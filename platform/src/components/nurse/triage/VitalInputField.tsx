'use client';

import Select from '@/components/Select';
import { type TriageVitalField, type TriageVitalWarning } from '@/lib/clinical/vitals';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { UNMEASURED_VITAL_REASONS } from './constants';

/**
 * One triage vital as an O3 field: the reading on the white field, and under
 * it a dropdown for whether it was taken — "Measured", or why it could not be
 * (UNMEASURED_VITAL_REASONS). Not taken clears and locks the reading.
 */
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
  const { t } = useTranslation();
  const message = error || warning?.message;
  const messageId = `triage-vital-${field}-message`;
  const tone = error || warning?.urgency === 'RED' ? 'var(--color-danger)' : 'var(--color-warning)';
  const isUnmeasured = unmeasuredReason !== undefined;

  return (
    <div className={`o3f-field o3f-vital${message ? ' has-message' : ''}`} data-vital-field={field}>
      <label htmlFor={`triage-vital-${field}`}><span className="o3f-label">{label}</span></label>
      <input
        id={`triage-vital-${field}`}
        type="text"
        className="o3f-input"
        inputMode={inputMode}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={isUnmeasured}
        aria-invalid={Boolean(error)}
        aria-describedby={message ? messageId : undefined}
        style={message ? { borderBottomColor: tone } : undefined}
      />
      <Select
        className="o3f-input o3f-vital-status"
        aria-label={t('triageO3.vitalTaken', { vital: label })}
        value={unmeasuredReason ?? ''}
        onChange={event => onUnmeasuredReasonChange(event.target.value === '' ? undefined : event.target.value)}
      >
        <option value="">{t('triageO3.measured')}</option>
        {UNMEASURED_VITAL_REASONS.map(([code, reasonLabel]) => (
          <option key={code} value={code}>{t('triageO3.notTaken', { reason: reasonLabel })}</option>
        ))}
      </Select>
      {message && (
        <p id={messageId} role={error ? 'alert' : 'status'} className="o3f-vital-message" style={{ color: tone }}>
          {error || `${warning?.urgency}: ${warning?.message}`}
        </p>
      )}
    </div>
  );
}
