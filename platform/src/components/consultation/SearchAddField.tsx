'use client';

import { useMemo, useState } from 'react';
import { Search, X } from '@/components/icons/lucide';

export default function SearchAddField({
  label,
  placeholder,
  options,
  onPick,
  onAdd,
  addLabel = 'Add',
  value,
  onChange,
  className = '',
}: {
  label?: string;
  placeholder: string;
  options: string[];
  onPick: (value: string) => void;
  onAdd?: (value: string) => void;
  addLabel?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const [internalQuery, setInternalQuery] = useState('');
  const [open, setOpen] = useState(false);
  const query = value ?? internalQuery;
  const setQuery = (next: string) => {
    if (onChange) onChange(next);
    else setInternalQuery(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? options.filter(option => option.toLowerCase().includes(q)) : options).slice(0, 8);
  }, [options, query]);

  const handlePick = (value: string) => {
    onPick(value);
    setQuery('');
    setOpen(false);
  };

  const handleAdd = () => {
    const value = query.trim();
    if (!value) return;
    if (onAdd) onAdd(value);
    else onPick(value);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && <label>{label}</label>}
      <div className="flex items-start gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          <input
            type="search"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onChange={e => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder={placeholder}
            className="search-icon-input"
            style={{ background: 'var(--overlay-subtle)', paddingInlineEnd: query ? 34 : undefined }}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setQuery(''); setOpen(true); }}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full transition-colors"
              style={{ width: 20, height: 20, color: 'var(--text-muted)', background: 'var(--border-light)' }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          )}
          {open && (
            <div className="absolute z-20 top-full start-0 end-0 mt-1 rounded-lg border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-light)', boxShadow: 'none' }}>
              {filtered.length > 0 ? (
                filtered.map(option => (
                  <button
                    key={option}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => handlePick(option)}
                    className="w-full px-4 py-2.5 text-start hover:bg-white/5 transition-colors"
                    style={{ borderBottom: '1px solid var(--border-light)' }}
                  >
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{option}</span>
                  </button>
                ))
              ) : (
                <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No matches found.
                </div>
              )}
            </div>
          )}
        </div>
        <button type="button" onClick={handleAdd} disabled={!query.trim()} className="btn btn-secondary btn-sm flex-shrink-0">
          {addLabel}
        </button>
      </div>
    </div>
  );
}
