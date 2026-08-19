'use client';

import { useState, useRef, useEffect } from 'react';
import { Filter, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';

export type ReferralFilterState = { patient: string; route: string; department: string; urgency: string; status: string };

/**
 * Referrals filter control — a "Filters" button that drops a panel of structured
 * controls (patient / route / department / urgency / status). Docked beside the
 * platform-wide search bar (via the TopBar `searchTrailing` slot); free-text
 * search lives in the search bar itself. Replaces the old per-column funnels.
 */
export default function ReferralFilters({
  filters,
  setFilter,
  clearAll,
  urgencyOptions,
  statusOptions,
}: {
  filters: ReferralFilterState;
  setFilter: (k: keyof ReferralFilterState, v: string) => void;
  clearAll: () => void;
  urgencyOptions: { v: string; l: string }[];
  statusOptions: { v: string; l: string }[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const activeCount = Object.values(filters).filter(Boolean).length;
  const fieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative inline-flex items-center justify-center transition-colors hover:bg-[var(--overlay-subtle)]"
        style={{
          width: 38, height: 38, padding: 0, flexShrink: 0,
          border: `1px solid ${activeCount ? 'var(--accent-primary)' : 'var(--border-light)'}`,
          background: activeCount ? 'rgba(33,145,208,0.08)' : 'var(--bg-card-solid)',
          borderRadius: 999,
          color: activeCount ? 'var(--accent-primary)' : 'var(--text-secondary)',
        }}
        title={t('patients.filtersTitle')}
        aria-label={t('patients.filtersTitle')}
        aria-expanded={open}
      >
        <Filter className="w-4 h-4" />
        {activeCount > 0 && (
          <span className="absolute inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold" style={{ top: -4, right: -4, background: 'var(--accent-primary)', color: '#fff' }}>
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute start-0 mt-2 rounded-2xl overflow-hidden z-50"
          style={{ width: 'min(92vw, 320px)', background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg, 0 16px 48px rgba(0,0,0,0.2))' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('patients.filtersTitle')}</span>
            <div className="flex items-center gap-2">
              {activeCount > 0 && (
                <button onClick={clearAll} className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{t('nurse.clearAllFilters')}</button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-[var(--overlay-subtle)]" aria-label={t('action.close')}>
                <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('referrals.patient')}</span>
              <input type="text" value={filters.patient} onChange={e => setFilter('patient', e.target.value)} placeholder={t('referrals.patient')} className="w-full text-sm py-2 px-3" style={fieldStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Route</span>
              <input type="text" value={filters.route} onChange={e => setFilter('route', e.target.value)} placeholder="From → To" className="w-full text-sm py-2 px-3" style={fieldStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('referrals.department')}</span>
              <input type="text" value={filters.department} onChange={e => setFilter('department', e.target.value)} placeholder={t('referrals.department')} className="w-full text-sm py-2 px-3" style={fieldStyle} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Urgency</span>
              <Select value={filters.urgency} onChange={e => setFilter('urgency', e.target.value)} className="w-full text-sm py-2 px-3" style={fieldStyle}>
                <option value="">{t('patients.all')}</option>
                {urgencyOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Status</span>
              <Select value={filters.status} onChange={e => setFilter('status', e.target.value)} className="w-full text-sm py-2 px-3" style={fieldStyle}>
                <option value="">{t('patients.all')}</option>
                {statusOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </Select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
