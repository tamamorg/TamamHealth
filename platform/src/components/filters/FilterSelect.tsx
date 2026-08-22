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
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
}: FilterSelectProps) {
  const neutral = neutralValue ?? options[0]?.value;
  const isActive = value !== neutral;
  const pad = size === 'sm' ? '6px 30px 6px 11px' : '8px 32px 8px 13px';
  const font = size === 'sm' ? 11 : 12.5;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      {label && (
        <span
          className="text-[9px] font-bold uppercase tracking-[0.07em] whitespace-nowrap"
          style={{ color: 'var(--text-muted)' }}
        >
          {label}
        </span>
      )}
      <Select
        value={value}
        aria-label={ariaLabel ?? label}
        onChange={e => onChange(e.target.value)}
        className="font-semibold cursor-pointer transition-all"
        style={{
          fontSize: font,
          width: 'auto',
          // backgroundColor, never the `background` shorthand: the shorthand
          // also resets background-image, which is where the global `select`
          // rule draws the dropdown chevron — leaving the 32px of padding-end
          // reserved for it below standing empty on every filter in the app.
          backgroundColor: isActive ? 'var(--accent-light)' : 'var(--bg-card-solid)',
          color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
          border: `1.5px solid ${isActive ? 'var(--accent-border)' : 'var(--border-light)'}`,
          borderRadius: 'var(--input-radius)',
          padding: pad,
          boxShadow: isActive ? '0 0 0 3px var(--accent-light)' : 'none',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
