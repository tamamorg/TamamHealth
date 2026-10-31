'use client';

/**
 * The doctor's order form fields, for any form that should read like it: a small
 * grey label over a filled field with a bottom rule, under plain section titles.
 * The lab and pharmacy forms draw with these, inside `.obk-root`.
 */

import type { ReactNode } from 'react';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import './order-basket.css';

export function ObfSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="obf-section">
      <div className="obf-section-head"><h4>{title}</h4>{aside}</div>
      {children}
    </section>
  );
}

export function ObfValue({ label, value }: { label: ReactNode; value?: ReactNode }) {
  return (
    <div className="obf-field">
      <span className="obf-label">{label}</span>
      <div className="obf-value">{value || '—'}</div>
    </div>
  );
}

export function ObfQuestion({ label, required, htmlFor, children }: {
  label: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  const head = <>{label}{required && <span className="obf-required" aria-hidden> *</span>}</>;
  return (
    <div className="obf-field">
      {htmlFor ? <label className="obf-label" htmlFor={htmlFor}>{head}</label> : <span className="obf-label">{head}</span>}
      {children}
    </div>
  );
}

export function ObfSelectField({ id, label, value, options, onChange, required, disabled, placeholder }: {
  id: string;
  label: ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Text of the empty choice; "Choose an option" by default. Pass null to offer none. */
  placeholder?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <ObfQuestion label={label} required={required} htmlFor={id}>
      <Select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {placeholder !== null && <option value="">{placeholder ?? t('o3form.chooseOption')}</option>}
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </ObfQuestion>
  );
}

export function ObfTextField({ id, label, value, onChange, placeholder, multiline, inputMode, required }: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
  required?: boolean;
}) {
  return (
    <ObfQuestion label={label} required={required} htmlFor={id}>
      {multiline
        ? <textarea id={id} rows={3} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        : <input id={id} type="text" inputMode={inputMode} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
    </ObfQuestion>
  );
}
