'use client';

/**
 * A short set of exclusive choices — Active / Inactive, Labs / Imaging,
 * Yes / No. The reference EHR marks the chosen segment with a filled block
 * and a check; this keeps both, so the choice reads without colour.
 *
 * Toggle-button semantics (`aria-pressed`), one Tab stop for the group with
 * ← → moving the choice, so a form full of these is not a form full of stops.
 */

import type { KeyboardEvent, ReactNode } from 'react';
import { Check } from '@/components/icons/lucide';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  block = false,
  showCheck = true,
  className = '',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md';
  /** Stretch to the container, each segment sharing the width equally. */
  block?: boolean;
  showCheck?: boolean;
  className?: string;
}) {
  const enabled = options.filter(option => !option.disabled);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    if (enabled.length === 0) return;
    event.preventDefault();
    const rtl = document.documentElement.dir === 'rtl';
    const forward = (event.key === 'ArrowRight') !== rtl;
    const at = enabled.findIndex(option => option.value === value);
    const next = enabled[(at + (forward ? 1 : enabled.length - 1)) % enabled.length];
    onChange(next.value);
    (event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`))?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={`tm-segmented${size === 'sm' ? ' tm-segmented--sm' : ''}${block ? ' tm-segmented--block' : ''}${className ? ` ${className}` : ''}`}
      onKeyDown={onKeyDown}
    >
      {options.map(option => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className="tm-segmented__btn"
            aria-pressed={pressed}
            data-value={option.value}
            disabled={option.disabled}
            tabIndex={pressed ? 0 : -1}
            onClick={() => { if (!pressed) onChange(option.value); }}
          >
            {showCheck && <span className="tm-segmented__check" aria-hidden="true"><Check /></span>}
            {option.icon && <span className="tm-segmented__icon" aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
            {typeof option.count === 'number' && <span className="tm-segmented__count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
