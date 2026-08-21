'use client';

/**
 * The form furniture shared by the two settings editors that sit behind the
 * facility picker: `FacilitySettingsView` (what varies per facility) and
 * `NetworkDefaultsView` (what is set once for every facility).
 *
 * They were local to FacilitySettingsView while it was the only editor. Both
 * views now import them from here — a shared file rather than one view
 * importing the other, which would be a cycle.
 */
import { useState } from 'react';
import { Plus, Save, X } from '@/components/icons/lucide';

/** Toggle a key in/out of a list. */
export function toggleKey<K extends string>(list: K[], key: K, set: (v: K[]) => void) {
  set(list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
}

/** Re-order a selection to match a canonical reference order. */
export function orderByReference<K extends string>(list: K[], reference: readonly K[]): K[] {
  return reference.filter(key => list.includes(key));
}

export function SectionCard({ icon: Icon, title, note = 'Facility-level configuration', children }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  /** Sub-line under the title — says which facilities the card governs. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ehr-set-section fs-section">
      <div className="ehr-set-section-head">
        <span><Icon /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>{title}</h3>
          <small>{note}</small>
        </div>
      </div>
      <div className="fs-section-body">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

export function SaveBar({ saving, onSave, label = 'Save changes', hint }: {
  saving: boolean;
  onSave: () => void;
  label?: string;
  /** Optional line to the left of the button — e.g. how many facilities a save touches. */
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</span>
      <button onClick={onSave} disabled={saving} className="btn btn-primary inline-flex items-center gap-2 flex-none">
        <Save className="w-4 h-4" /> {saving ? 'Saving…' : label}
      </button>
    </div>
  );
}

export function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2.5 text-sm py-1.5" style={{ color: 'var(--text-secondary)' }}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {label}
    </label>
  );
}

export function TextareaListEditor({ label, values, onChange }: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Field label={label}>
      <textarea
        className="fs-input"
        rows={3}
        value={values.join('\n')}
        onChange={e => onChange(e.target.value.split('\n').map(v => v.trim()).filter(Boolean))}
      />
    </Field>
  );
}

export function TagListEditor({ label, placeholder, values, onChange }: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [entry, setEntry] = useState('');
  const add = () => {
    const v = entry.trim();
    if (!v || values.includes(v)) { setEntry(''); return; }
    onChange([...values, v]);
    setEntry('');
  };
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div className="flex items-center gap-2 mb-3">
        <input
          className="fs-input"
          value={entry}
          placeholder={placeholder}
          onChange={e => setEntry(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} className="btn btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              aria-label={`Remove ${v}`}
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>None added yet.</span>
        )}
      </div>
    </div>
  );
}
