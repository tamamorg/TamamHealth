'use client';

/**
 * A form in the OpenMRS O3 shape — the one layout every structured form in the
 * platform uses: the chart's Clinical forms (Covid 19, Laboratory Test
 * Results, Mental Health Assessment, Surgical Operation) and the lab bench's
 * result entry.
 *
 *  - several pages: a page list on the left (the active page marked by its
 *    bar), Save and Cancel beneath it; one page: no list, and Cancel | Save as
 *    the full-width action bar at the foot, as O3 draws a single-page form;
 *  - every page in turn: a large page title that collapses, its sections as
 *    lighter headers that collapse, each over a grey body;
 *  - fields as O3 draws them: number fields with − | + steppers, choices as
 *    radio buttons (or a dropdown, or checkboxes for "tick all that apply"),
 *    text, dates and times on a white field with one bottom rule; a red * on a
 *    required question; an "Unspecified" box where a question allows it;
 *    calculated fields (scores) read-only.
 *
 * Values are a flat record keyed by field id; a checkbox field stores its
 * ticks joined with `CHECK_SEPARATOR`, "Unspecified" is `UNSPECIFIED`, and a
 * date-time field `YYYY-MM-DDTHH:MM`.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Minus, Plus } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import '@/components/ehr/chart/panels/start-visit-panel.css';
import './o3-form.css';

export const CHECK_SEPARATOR = '|';
export const UNSPECIFIED = '__unspecified__';

export type O3FieldKind = 'number' | 'text' | 'textarea' | 'date' | 'datetime' | 'radio' | 'select' | 'checkboxes';

export interface O3Field {
  id: string;
  label: string;
  kind: O3FieldKind;
  unit?: string;
  options?: string[];
  /** Step for the number stepper (default 1). */
  step?: number;
  required?: boolean;
  /** Offer an "Unspecified" box under the answer. */
  allowUnspecified?: boolean;
  /** A calculated field: shown read-only, worked out from the other answers. */
  compute?: (values: Record<string, string>) => string;
}

export interface O3Section {
  id: string;
  label: string;
  /** Optional small heading inside the grey body ("Covid 19 Set"). */
  caption?: string;
  /** Text-only section ("Introduction"): a bold heading and paragraphs. */
  intro?: { heading?: string; paragraphs: { lead?: string; text: string }[] };
  fields: O3Field[];
}

export interface O3Page {
  id: string;
  label: string;
  sections: O3Section[];
}

/** Every field in `pages`, in order. */
export const o3Fields = (pages: O3Page[]): O3Field[] => pages.flatMap(p => p.sections.flatMap(s => s.fields));

/** Required fields left blank (an "Unspecified" tick counts as answered). */
export function o3MissingRequired(pages: O3Page[], values: Record<string, string>): O3Field[] {
  return o3Fields(pages).filter(f => f.required && !f.compute && !(values[f.id] ?? '').trim());
}

/** The answers with every calculated field filled in, ready to store. */
export function o3WithComputed(pages: O3Page[], values: Record<string, string>): Record<string, string> {
  const out = { ...values };
  for (const f of o3Fields(pages)) if (f.compute) out[f.id] = f.compute(values);
  return out;
}

export default function O3Form({
  pages,
  values,
  onChange,
  onSave,
  onCancel,
  saving = false,
  saveLabel,
  cancelLabel,
  onBack,
  backLabel,
  disabled = false,
  notice,
  invalid,
}: {
  pages: O3Page[];
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
  /** Save and Cancel; omit both when the host has its own actions. */
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  /** "← Back to clinical forms". */
  onBack?: () => void;
  backLabel?: string;
  disabled?: boolean;
  /** A message above the pages (an error, a lock). */
  notice?: ReactNode;
  /** Field ids to mark — required questions left blank at Save. */
  invalid?: ReadonlySet<string>;
}) {
  const { t } = useTranslation();

  const field = (f: O3Field) => {
    const id = `o3f-${f.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const computed = f.compute ? f.compute(values) : undefined;
    const raw = computed ?? values[f.id] ?? '';
    const unspecified = raw === UNSPECIFIED;
    const value = unspecified ? '' : raw;
    const off = disabled || unspecified || !!f.compute;
    const label = (
      <span className="o3f-label" id={`${id}-label`}>
        {f.label}{f.unit ? ` (${f.unit})` : ''}
        {f.required && <span className="o3f-required" aria-hidden>*</span>}
      </span>
    );
    const isChoice = f.kind === 'radio' || f.kind === 'select';
    // "Unspecified" is a choice like any other: an option in a choice
    // question's dropdown, and for any other question a dropdown under it
    // (Answered / Unspecified) that locks the answer while unspecified.
    const unspecifiedBox = f.allowUnspecified && !f.compute && !isChoice && (
      <Select className="o3f-input o3f-answer-status" aria-label={`${f.label}: ${t('o3form.unspecified')}`}
        value={unspecified ? UNSPECIFIED : ''} disabled={disabled}
        onChange={e => onChange(f.id, e.target.value === UNSPECIFIED ? UNSPECIFIED : '')}>
        <option value="">{t('o3form.answered')}</option>
        <option value={UNSPECIFIED}>{t('o3form.unspecified')}</option>
      </Select>
    );
    let control: ReactNode;
    switch (f.kind) {
      case 'number': {
        const step = f.step ?? 1;
        const bump = (dir: 1 | -1) => {
          const n = Number(value);
          const base = Number.isFinite(n) && value !== '' ? n : 0;
          onChange(f.id, String(Math.round((base + dir * step) * 1000) / 1000));
        };
        control = (
          <div className={`o3f-number${f.compute ? ' is-computed' : ''}`}>
            <input id={id} type="text" inputMode="decimal" value={value} disabled={off} readOnly={!!f.compute}
              aria-required={f.required || undefined} onChange={e => onChange(f.id, e.target.value)} />
            <button type="button" aria-label={`− ${f.label}`} disabled={off} onClick={() => bump(-1)}><Minus aria-hidden /></button>
            <span className="o3f-number-rule" aria-hidden />
            <button type="button" aria-label={`+ ${f.label}`} disabled={off} onClick={() => bump(1)}><Plus aria-hidden /></button>
          </div>
        );
        break;
      }
      // Every choice is a dropdown — one answer a select, several a
      // multi-select. ('radio' is kept as a kind so definitions read as the
      // O3 source does; it draws as a dropdown.)
      case 'radio':
      case 'select':
        control = (
          <Select id={id} className="o3f-input" value={raw} disabled={disabled || !!f.compute} aria-required={f.required || undefined}
            onChange={e => onChange(f.id, e.target.value)}>
            <option value="">{t('o3form.chooseOption')}</option>
            {(f.options || []).map(option => <option key={option} value={option}>{option}</option>)}
            {f.allowUnspecified && <option value={UNSPECIFIED}>{t('o3form.unspecified')}</option>}
          </Select>
        );
        break;
      case 'checkboxes':
        control = (
          <O3MultiSelect
            id={id}
            values={value ? value.split(CHECK_SEPARATOR) : []}
            options={(f.options || []).map(o => ({ value: o, label: o }))}
            disabled={off}
            onChange={next => onChange(f.id, (f.options || []).filter(o => next.includes(o)).join(CHECK_SEPARATOR))}
          />
        );
        break;
      case 'textarea':
        control = <textarea id={id} className="o3f-input" rows={4} value={value} disabled={off} onChange={e => onChange(f.id, e.target.value)} />;
        break;
      case 'date':
        control = <input id={id} type="date" className="o3f-input o3f-input--date" value={value} disabled={off} onChange={e => onChange(f.id, e.target.value)} />;
        break;
      case 'datetime': {
        const [date = '', time = ''] = value.split('T');
        const set = (d: string, tm: string) => onChange(f.id, d || tm ? `${d}T${tm}` : '');
        control = (
          <div className="o3f-datetime">
            <input id={id} type="date" className="o3f-input o3f-input--date" value={date} disabled={off} onChange={e => set(e.target.value, time)} />
            <label className="o3f-time">
              <span className="o3f-label">{t('o3form.time')}</span>
              <input type="time" className="o3f-input" value={time} disabled={off} onChange={e => set(date, e.target.value)} />
            </label>
          </div>
        );
        break;
      }
      default:
        control = <input id={id} type="text" className="o3f-input" value={value} disabled={off} onChange={e => onChange(f.id, e.target.value)} />;
    }
    const wide = f.kind === 'textarea' || f.kind === 'text' || f.kind === 'checkboxes';
    return (
      <div className={`o3f-field${wide ? ' o3f-field--wide' : ''}${invalid?.has(f.id) && !raw ? ' is-invalid' : ''}`} key={f.id}>
        <label htmlFor={id}>{label}</label>
        {control}
        {unspecifiedBox}
      </div>
    );
  };

  return (
    <O3Layout
      pages={pages.map(page => ({
        id: page.id,
        label: page.label,
        sections: page.sections.map(section => ({
          id: section.id,
          label: section.label,
          body: <>
            {section.caption && <p className="o3f-caption">{section.caption}</p>}
            {section.intro && (
              <div className="o3f-intro">
                {section.intro.heading && <h3>{section.intro.heading}</h3>}
                {section.intro.paragraphs.map((p, i) => (
                  <p key={i}>{p.lead && <strong>{p.lead} </strong>}{p.text}</p>
                ))}
              </div>
            )}
            {section.fields.map(field)}
          </>,
        })),
      }))}
      onSave={onSave}
      onCancel={onCancel}
      saving={saving}
      saveDisabled={disabled}
      saveLabel={saveLabel}
      cancelLabel={cancelLabel}
      onBack={onBack}
      backLabel={backLabel}
      notice={notice}
    />
  );
}

export interface O3LayoutSection { id: string; label: string; body: ReactNode }
export interface O3LayoutPage { id: string; label: string; sections: O3LayoutSection[] }

/**
 * The O3 form frame on its own — page list with Save and Cancel, collapsible
 * page titles, collapsible sections over grey bodies — for a form whose
 * questions are its own components (the triage assessment) rather than
 * O3Field definitions. O3Form draws through it.
 */
export function O3Layout({
  pages,
  onSave,
  onCancel,
  saving = false,
  saveDisabled = false,
  saveLabel,
  cancelLabel,
  onBack,
  backLabel,
  notice,
  className = '',
}: {
  pages: O3LayoutPage[];
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  onBack?: () => void;
  backLabel?: string;
  notice?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [activePage, setActivePage] = useState(pages[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const pageRefs = useRef<Record<string, HTMLElement | null>>({});
  const singlePage = pages.length <= 1;
  const pageIds = pages.map(p => p.id).join('|');

  // The page list follows the scroll: the page nearest the top is marked.
  useEffect(() => {
    if (singlePage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActivePage((top.target as HTMLElement).dataset.page || '');
    }, { rootMargin: '0px 0px -70% 0px' });
    for (const el of Object.values(pageRefs.current)) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [pageIds, singlePage]);

  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const goTo = (pageId: string) => {
    setActivePage(pageId);
    setCollapsed(prev => { const next = new Set(prev); next.delete(`page:${pageId}`); return next; });
    pageRefs.current[pageId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const save = saveLabel ?? t('action.save');
  const cancel = cancelLabel ?? t('action.cancel');
  const actionsInNav = !singlePage && (onSave || onCancel);
  return (
    <div className={`o3f${singlePage ? ' o3f--single' : ''}${className ? ` ${className}` : ''}`}>
      {onBack && (
        <button type="button" className="o3f-back" onClick={onBack}>
          <ArrowLeft aria-hidden /> {backLabel}
        </button>
      )}
      <div className="o3f-grid">
        {!singlePage && (
          <nav className="o3f-nav" aria-label={t('o3form.pages')}>
            {pages.map(page => (
              <button
                key={page.id}
                type="button"
                className={`o3f-nav-item${activePage === page.id ? ' is-active' : ''}`}
                aria-current={activePage === page.id ? 'true' : undefined}
                onClick={() => goTo(page.id)}
              >
                {page.label}
              </button>
            ))}
            {actionsInNav && (
              <div className="o3f-nav-actions">
                {onSave && <button type="button" className="o3f-save" onClick={onSave} disabled={saving || saveDisabled}>{saving ? t('noteEditor.saving') : save}</button>}
                {onCancel && <button type="button" className="o3f-cancel" onClick={onCancel} disabled={saving}>{cancel}</button>}
              </div>
            )}
          </nav>
        )}
        <div className="o3f-pages">
          {notice}
          {pages.map(page => {
            const pageKey = `page:${page.id}`;
            const pageOpen = !collapsed.has(pageKey);
            return (
              <section key={page.id} className="o3f-page" data-page={page.id} ref={el => { pageRefs.current[page.id] = el; }}>
                <button type="button" className="o3f-page-head" aria-expanded={pageOpen} onClick={() => toggle(pageKey)}>
                  <h2>{page.label}</h2>
                  {pageOpen ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                </button>
                {pageOpen && page.sections.map(section => {
                  const sectionKey = `section:${page.id}:${section.id}`;
                  const open = !collapsed.has(sectionKey);
                  return (
                    <div key={section.id} className="o3f-section">
                      {/* A page that is one section of the same name (an ANC
                          step) shows its title once. */}
                      {!(page.sections.length === 1 && section.label === page.label) && (
                        <button type="button" className="o3f-section-head" aria-expanded={open} onClick={() => toggle(sectionKey)}>
                          <span>{section.label}</span>
                          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                        </button>
                      )}
                      {open && <div className="o3f-section-body">{section.body}</div>}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      {singlePage && (onSave || onCancel) && (
        <div className="sv-footer o3f-footer">
          {onCancel && <button type="button" className="sv-footer-btn sv-footer-btn--discard" onClick={onCancel} disabled={saving}>{cancel}</button>}
          {onSave && (
            <button type="button" className="sv-footer-btn sv-footer-btn--primary" onClick={onSave} disabled={saving || saveDisabled}>
              {saving ? t('noteEditor.saving') : save}
              <Check aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Fields for forms whose state is their own (triage, ANC) ─────────────────
// Every choice on a clinical form is a dropdown: one answer a native select,
// several a multi-select dropdown (O3MultiSelect). Same look as O3Form's own.

export interface O3Option { value: string; label: string }

/** One labelled question in the O3 field shape. */
export function O3Question({ label, required, htmlFor, wide, invalid, children }: {
  label: ReactNode;
  required?: boolean;
  htmlFor?: string;
  wide?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  const head = (
    <span className="o3f-label">
      {label}
      {required && <span className="o3f-required" aria-hidden>*</span>}
    </span>
  );
  return (
    <div className={`o3f-field${wide ? ' o3f-field--wide' : ''}${invalid ? ' is-invalid' : ''}`}>
      {htmlFor ? <label htmlFor={htmlFor}>{head}</label> : head}
      {children}
    </div>
  );
}

/** A single-answer dropdown question. An empty value is "Choose an option". */
export function O3SelectField({ id, label, value, options, onChange, required, wide, invalid, disabled, placeholder }: {
  id: string;
  label: ReactNode;
  value: string;
  options: O3Option[];
  onChange: (value: string) => void;
  required?: boolean;
  wide?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  /** Text of the empty choice; "Choose an option" by default. Pass null to offer none. */
  placeholder?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <O3Question label={label} required={required} htmlFor={id} wide={wide} invalid={invalid && !value}>
      <Select id={id} className="o3f-input" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {placeholder !== null && <option value="">{placeholder ?? t('o3form.chooseOption')}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </O3Question>
  );
}

/** A free-text (or number) question on the O3 field. */
export function O3TextField({ id, label, value, onChange, placeholder, wide, multiline, inputMode, required, invalid }: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  wide?: boolean;
  multiline?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <O3Question label={label} required={required} htmlFor={id} wide={wide ?? multiline} invalid={invalid && !value.trim()}>
      {multiline
        ? <textarea id={id} className="o3f-input" rows={3} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        : <input id={id} type="text" inputMode={inputMode} className="o3f-input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
    </O3Question>
  );
}

/** "Tick all that apply" as a dropdown: the closed field lists the choices
 *  made; open, every option is a checkbox. Closes on outside press or Escape. */
export function O3MultiSelect({ id, values, options, onChange, disabled, tone }: {
  id: string;
  values: string[];
  options: O3Option[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  /** Colours the chosen summary — red/yellow danger-sign lists. */
  tone?: 'danger' | 'warning';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    // Capture phase: Escape closes the list, not the drawer around the form.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const chosen = options.filter(o => values.includes(o.value));
  return (
    <div className={`o3f-multi${open ? ' is-open' : ''}`} ref={ref}>
      <button
        id={id}
        type="button"
        className={`o3f-input o3f-multi-trigger${chosen.length && tone ? ` is-${tone}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <span className="o3f-multi-value">
          {chosen.length ? chosen.map(o => o.label).join(', ') : t('o3form.chooseOptions')}
        </span>
        {chosen.length > 1 && <span className="o3f-multi-count">{chosen.length}</span>}
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="o3f-multi-panel" role="listbox" aria-multiselectable="true">
          {options.map(o => (
            <label key={o.value} className="o3f-choice">
              <input
                type="checkbox"
                checked={values.includes(o.value)}
                onChange={e => onChange(e.target.checked
                  ? options.filter(x => x.value === o.value || values.includes(x.value)).map(x => x.value)
                  : values.filter(v => v !== o.value))}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** A multi-answer dropdown question. */
export function O3MultiSelectField({ id, label, values, options, onChange, wide = true, tone, disabled }: {
  id: string;
  label: ReactNode;
  values: string[];
  options: O3Option[];
  onChange: (values: string[]) => void;
  wide?: boolean;
  tone?: 'danger' | 'warning';
  disabled?: boolean;
}) {
  return (
    <O3Question label={label} htmlFor={id} wide={wide}>
      <O3MultiSelect id={id} values={values} options={options} onChange={onChange} tone={tone} disabled={disabled} />
    </O3Question>
  );
}
