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
 *
 * A pick does not act at once: it opens a "Change status" slider (Now →
 * Change to) and `onSelect` runs on its confirm — the same as every visit
 * status pill on the dashboards (StatusChangeSlider), so a row in a scrolled
 * list cannot change on a stray pick.
 */

import { Fragment, useState, type CSSProperties } from 'react';
import { stopsClickPropagation } from '@/lib/a11y';
import FormSlider from '@/components/overlay/FormSlider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import '@/components/ehr/chart/panels/start-visit-panel.css';

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
  subject,
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
  /** Whose row this is, for the confirm slider's subtitle. */
  subject?: string;
  className?: string;
  /** Pill tint (border/background/colour) from the page's status tokens. */
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<RowStatusOption | null>(null);
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
          // Matches AppointmentStatusPillSelect: a focused <select> shows the
          // :focus-visible ring even after a mouse pick, so drop focus once
          // the choice is committed rather than leaving the pill outlined.
          event.target.blur();
          if (next !== value) setPending(options.find(o => o.value === next) ?? { value: next, label: next });
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
      {/* A grouped option is an action, not a state ("Remove shift",
          "Assign to me"): it confirms as that action, not as Now → Change to. */}
      {pending && (
        <FormSlider
          title={pending.group ? t('statusSlider.titleAction') : t('statusSlider.titleGeneric')}
          subtitle={subject}
          width={440}
          onClose={() => setPending(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>{t('action.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={() => { const next = pending.value; setPending(null); onSelect(next); }}>
              {pending.group ? pending.label : t('statusSlider.confirm', { status: pending.label })}
            </button>
          </>}
        >
          <dl className="status-slider-change">
            {pending.group ? (
              <div><dt>{pending.group}</dt><dd>{pending.label}</dd></div>
            ) : (<>
              <div><dt>{t('statusSlider.from')}</dt><dd>{label}</dd></div>
              <div><dt>{t('statusSlider.to')}</dt><dd>{pending.label}</dd></div>
            </>)}
          </dl>
        </FormSlider>
      )}
    </span>
  );
}
