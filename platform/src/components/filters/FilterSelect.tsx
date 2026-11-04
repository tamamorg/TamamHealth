'use client';

import Select from '@/components/Select';

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Optional micro-label rendered before the control. */
  label?: string;
  /**
   * The value that counts as "no filter applied". When the current value
   * differs from this, the control lights up with the accent treatment.
   * Defaults to the first option's value.
   */
  neutralValue?: string;
  /** Kept for callers; every filter field is the same height now. */
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * Styled categorical filter. The searchable `Select` under the hood (which
 * keeps a real native control as its trigger, so this stays keyboard- and
 * mobile-friendly) but with a clear active state: once a non-neutral value is
 * chosen it adopts the accent tint + border, so users can see at a glance
 * which filters are narrowing the list.
 */
export default function FilterSelect({
  value,
  onChange,
  options,
  label,
  neutralValue,
  className = '',
  'aria-label': ariaLabel,
}: FilterSelectProps) {
  const neutral = neutralValue ?? options[0]?.value;
  const isActive = value !== neutral;

  // Styled by the one filter look (globals.css "FILTER PANELS"): a label above
  // a square field; a field narrowing the list shows the accent. `size` is
  // kept for callers; the panel gives every field the same height.
  return (
    <label className={`tm-filter-select${isActive ? ' is-active' : ''} ${className}`.trim()}>
      {label && <span className="tm-filter-select__label">{label}</span>}
      <Select
        value={value}
        aria-label={ariaLabel ?? label}
        onChange={e => onChange(e.target.value)}
        className="tm-filter-select__control"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
