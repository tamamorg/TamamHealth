'use client';

/**
 * A station row's status pill that is also its action menu, the way the front
 * desk moves a visit from its pill. The list offers only what can happen next;
 * a pick opens the work in the right-hand slider, where Cancel and Save decide
 * it. Finished work has no next step, so its pill is plain and only opens.
 */

import { stopsClickPropagation } from '@/lib/a11y';

export interface StationAction {
  value: string;
  label: string;
}

export default function StationActionPill({ label, className = '', actions = [], ariaLabel, onPick, onOpen }: {
  label: string;
  className?: string;
  actions?: StationAction[];
  ariaLabel: string;
  onPick?: (value: string) => void;
  /** With no action left, the pill reads the finished work. */
  onOpen?: () => void;
}) {
  if (actions.length > 0 && onPick) {
    return (
      // The select is the control; the span keeps the row's handlers out of it.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <span
        className={`appointment-status-pill appointment-status-pill--select ${className}`.trim()}
        {...stopsClickPropagation}
        onKeyDown={event => event.stopPropagation()}
      >
        {label}
        <select
          value=""
          aria-label={ariaLabel}
          onChange={event => {
            event.stopPropagation();
            const next = event.target.value;
            event.target.blur();
            if (next) onPick(next);
          }}
        >
          <option value="" disabled>{label}</option>
          {actions.map(action => <option key={action.value} value={action.value}>{action.label}</option>)}
        </select>
      </span>
    );
  }
  if (onOpen) {
    return (
      <button
        type="button"
        className={`appointment-status-pill ehr-station-pill-open ${className}`.trim()}
        aria-label={ariaLabel}
        onClick={event => { event.stopPropagation(); onOpen(); }}
      >
        {label}
      </button>
    );
  }
  return <span className={`appointment-status-pill ${className}`.trim()}>{label}</span>;
}
