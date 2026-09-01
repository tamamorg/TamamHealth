'use client';

/**
 * The status pill that IS the row's action menu — the list-row counterpart of
 * `AppointmentStatusPillSelect`, generalised so any worklist can use it.
 *
 * Why this instead of a trailing kebab column: the patient registry's row has
 * five columns and no actions gutter, and every clinical worklist already
 * moves a row along its ladder by opening the status pill. A separate pencil
 * button was a sixth column that pushed the data columns out of alignment with
 * the registry and offered a second, competing place to change a row's state.
 *
 * The pill keeps its tint and label; the real <select> is laid transparently
 * over it as the hit target (styling in globals.css under
 * `.appointment-status-pill--select`). Options that aren't lifecycle states —
 * "Assign to me", "Remove shift" — ride in their own <optgroup> so the ladder
 * stays readable. With no options at all it degrades to the plain read-only
 * pill, which is what a viewer without permission should see.
 */

import { Fragment, type CSSProperties } from 'react';
import { stopsClickPropagation } from '@/lib/a11y';

export interface RowStatusOption {
  /** Value handed back to `onSelect`. Use a distinct token for non-status actions. */
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional <optgroup> heading; consecutive options sharing one are grouped. */
  group?: string;
}

export default function RowStatusSelect({
  label,
  value,
  options,
  onSelect,
  ariaLabel,
  className = '',
  style,
}: {
  /** Text shown on the pill — the current state, already translated. */
  label: string;
  /** Current value, so the control reads correctly and resets after an action. */
  value: string;
  options: RowStatusOption[];
  onSelect: (value: string) => void;
  ariaLabel: string;
  className?: string;
  /** Pill tint (border/background/colour) from the page's status tokens. */
  style?: CSSProperties;
}) {
  if (options.length === 0) {
    return <span className={`appointment-status-pill ${className}`.trim()} style={style}>{label}</span>;
  }

  // Group consecutive options that share a `group`, preserving author order.
  const groups: { name?: string; items: RowStatusOption[] }[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.items.push(option);
    else groups.push({ name: option.group, items: [option] });
  }

  const renderOption = (option: RowStatusOption) => (
    <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
  );

  return (
    // Same shape as AppointmentStatusPillSelect: the native <select> inside is
    // the control, this span only keeps the row's own handlers out of it.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      className={`appointment-status-pill appointment-status-pill--select ${className}`.trim()}
      style={style}
      {...stopsClickPropagation}
      onKeyDown={event => event.stopPropagation()}
    >
      {label}
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={event => {
          event.stopPropagation();
          const next = event.target.value;
          if (next !== value) onSelect(next);
        }}
      >
        {/* The current state leads the list, disabled: a native select must
            have its value present as an option or it renders blank. */}
        {!options.some(o => o.value === value) && <option value={value} disabled>{label}</option>}
        {groups.map((group, index) => (
          group.name
            ? <optgroup key={group.name} label={group.name}>{group.items.map(renderOption)}</optgroup>
            // Ungrouped options stay bare: an <optgroup label=""> renders a
            // blank heading row in Safari and Firefox.
            : <Fragment key={`ungrouped-${index}`}>{group.items.map(renderOption)}</Fragment>
        ))}
      </select>
    </span>
  );
}
