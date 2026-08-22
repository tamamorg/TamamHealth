'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from '@/components/icons/lucide';

export type PopupSelectOption = { value: string; label: string };
export type PopupSelectGroup = { label: string; options: PopupSelectOption[] };

/**
 * Popup-based replacement for native <select> dropdowns.
 *
 * The trigger looks like the app's selects; picking opens a centred popup
 * with at least ten option rows visible and the rest scrollable — far
 * easier on tablets than the OS dropdown menu. Long lists (>10) get a
 * search box. When `groups` are provided the picker becomes a two-step
 * flow (choose a group → choose an option) with back navigation and a
 * step indicator.
 */
export default function PopupSelect({
  label,
  value,
  onChange,
  options,
  groups,
  placeholder = 'Select…',
  compact = false,
  triggerStyle,
}: {
  /** Popup title (and accessible name for the trigger). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: (string | PopupSelectOption)[];
  /** Two-step mode: pick a group, then one of its options. */
  groups?: PopupSelectGroup[];
  placeholder?: string;
  /** Smaller trigger for inline/table rows. */
  compact?: boolean;
  triggerStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<PopupSelectGroup | null>(null);

  const flatOptions = useMemo<PopupSelectOption[]>(() => {
    if (groups) return groups.flatMap(g => g.options);
    return (options || []).map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  }, [options, groups]);

  const selected = flatOptions.find(o => o.value === value);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActiveGroup(null);
  };

  const pick = (v: string) => {
    onChange(v);
    close();
  };

  const q = query.trim().toLowerCase();
  const visibleOptions = (activeGroup ? activeGroup.options : groups ? [] : flatOptions)
    .filter(o => !q || o.label.toLowerCase().includes(q));
  const visibleGroups = groups && !activeGroup
    ? groups.filter(g => !q || g.label.toLowerCase().includes(q) || g.options.some(o => o.label.toLowerCase().includes(q)))
    : [];
  const showSearch = (groups ? flatOptions.length : flatOptions.length) > 10;
  const stepCount = groups ? 2 : 1;
  const stepIndex = groups ? (activeGroup ? 2 : 1) : 1;

  return (
    <>
      <button
        type="button"
        className={`popup-select-trigger${compact ? ' popup-select-trigger--compact' : ''}`}
        style={triggerStyle}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={label}
      >
        <span className={selected ? '' : 'popup-select-placeholder'}>{selected?.label || placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5" aria-hidden />
      </button>

      {open && (
        <Modal onClose={close} width={440}>
          <div className="modal-content card-elevated popup-select-panel" style={{ width: '100%' }}>
            <div className="popup-select-head modal-headband">
              {activeGroup ? (
                <button type="button" className="popup-select-back" onClick={() => { setActiveGroup(null); setQuery(''); }}>
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
              ) : <span />}
              <div className="popup-select-title">
                <strong>{activeGroup ? activeGroup.label : label}</strong>
                {stepCount > 1 && (
                  <span>Step {stepIndex} of {stepCount} · {stepIndex === 1 ? 'Choose a category' : 'Choose an option'}</span>
                )}
              </div>
              <button type="button" className="popup-select-close" onClick={close} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {showSearch && (
              <div className="popup-select-search">
                <Search className="w-4 h-4" aria-hidden />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  placeholder="Search…"
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
            )}

            {/* Ten 44px rows visible; anything longer scrolls inside. */}
            <div className="popup-select-list" role="listbox" aria-label={label}>
              {visibleGroups.map(g => (
                <button key={g.label} type="button" className="popup-select-row" onClick={() => { setActiveGroup(g); setQuery(''); }}>
                  <span className="popup-select-row-label">{g.label}</span>
                  <span className="popup-select-row-meta">{g.options.length}</span>
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </button>
              ))}
              {visibleOptions.map(o => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`popup-select-row${o.value === value ? ' is-selected' : ''}`}
                  onClick={() => pick(o.value)}
                >
                  <span className="popup-select-row-label">{o.label}</span>
                  {o.value === value && <Check className="w-4 h-4" aria-hidden />}
                </button>
              ))}
              {visibleGroups.length === 0 && visibleOptions.length === 0 && (
                <p className="popup-select-empty">No matches.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
