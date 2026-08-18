'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  DuotoneSearch as Search,
  DuotoneUser as UserIcon,
  DuotoneArrowRight as ArrowRight,
} from '@/components/icons';
import { useApp } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { patientFullName, patientGenderAge } from '@/lib/patient-utils';
import { formatPhoneDisplay } from '@/lib/field-formats';

/**
 * Platform-wide search bar. Lives at the top of the content area on every
 * dashboard page (rendered by TopBar) — the single search entry point after
 * the old TopBar header search was removed. Bound to the same `globalSearch`
 * context the list pages read, so typing here narrows the current page and the
 * quick-jump dropdown lets you jump straight to a patient record.
 */
// `splitActions` lays the row out on the same 2-column grid the dashboard cards
// use (search + trailing in the left column, actions right-aligned in the right
// column), so the search bar lines up edge-to-edge with the cards below it.
// `hideInput` drops the text search field (and its quick-jump dropdown) while
// keeping the actions/trailing row — used on pages that already have the
// platform header search and don't want a duplicate search box (e.g. payments).
// `title`/`titleIcon` render the page title as the row's leading, non-shrinking
// item — TopBar hands these down so the title sits on the same line as the
// search box and actions instead of stacked in a row of its own.
export default function GlobalSearchBar({ title, titleIcon, actions, searchTrailing, splitActions, hideInput }: { title?: string; titleIcon?: ReactNode; actions?: ReactNode; searchTrailing?: ReactNode; splitActions?: boolean; hideInput?: boolean } = {}) {
  const { t } = useTranslation();
  const { globalSearch, setGlobalSearch } = useApp();
  const [localSearch, setLocalSearch] = useState(globalSearch);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { patients } = usePatients();

  // Keep the local field in sync when another surface clears/sets the global
  // search (e.g. jumping to a patient resets it).
  useEffect(() => { setLocalSearch(globalSearch); }, [globalSearch]);

  const handleSearch = useCallback((value: string) => {
    setLocalSearch(value);
    setDropdownOpen(value.trim().length >= 2);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setGlobalSearch(value), 300);
  }, [setGlobalSearch]);

  // Live patient quick-jump matches (top 6) — cross-module search instead of
  // just narrowing the current list.
  const patientMatches = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return (patients || [])
      .filter(p =>
        `${p.firstName || ''} ${p.surname || ''}`.toLowerCase().includes(q) ||
        (p.hospitalNumber || '').toLowerCase().includes(q) ||
        (p.phone || '').includes(q)
      )
      .slice(0, 6);
  }, [localSearch, patients]);

  // Click outside to close dropdown
  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  const jumpToPatient = (id: string) => {
    setDropdownOpen(false);
    setLocalSearch('');
    setGlobalSearch('');
    router.push(`/patients/${id}`);
  };

  const clear = () => { setLocalSearch(''); setGlobalSearch(''); setDropdownOpen(false); };

  // Any page that supplies actions or a filter control uses the split 2-column
  // grid layout (search + trailing left, actions right) so the row lines up
  // edge-to-edge with the dashboard cards below — matching the reception page.
  // Title-only pages keep the simple full-width search but use the same mx-5
  // gutter so the search bar still aligns with the cards.
  const split = splitActions || !!actions || !!searchTrailing;

  return (
    <div className={split
      ? 'mx-[10px] mt-[10px] flex-shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-center'
      : 'mx-[10px] mt-[10px] flex-shrink-0 flex items-center gap-3 flex-wrap'}>
      {/* In split mode this groups search + trailing into the left grid column;
          otherwise `contents` makes them plain flex children as before. */}
      <div className={split ? 'flex items-center gap-3 min-w-0' : 'contents'}>
      {title && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {titleIcon}
          <h1 className="text-base font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        </div>
      )}
      {!hideInput && (
      <div className={split ? 'relative flex-1 min-w-0' : 'relative flex-1 min-w-[220px] max-w-2xl'} ref={searchContainerRef}>
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px]" color="var(--text-muted)" />
        <input
          type="search"
          placeholder={t('topbar.searchPlaceholder')}
          value={localSearch}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => { if (localSearch.trim().length >= 2) setDropdownOpen(true); }}
          className="search-icon-input w-full py-3 pr-4 text-sm"
          style={{
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-card-solid)',
            color: 'var(--text-primary)',
            borderRadius: 'var(--input-radius)',
            boxShadow: 'var(--card-shadow)',
            transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
          }}
        />

        {/* Quick-jump dropdown */}
        {dropdownOpen && localSearch.trim().length >= 2 && (
          <div
            className="absolute top-full left-0 mt-1.5 rounded-xl overflow-hidden z-50"
            style={{
              width: 'min(100%, 420px)',
              background: 'var(--bg-card-solid)',
              border: '1px solid var(--border-medium)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.06)',
            }}
          >
            {patientMatches.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('topbar.noPatientMatches', { query: localSearch })}
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {t('topbar.searchHint')}
                </p>
              </div>
            ) : (
              <>
                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>
                  {t('topbar.patientsCount', { count: patientMatches.length })}
                </div>
                {patientMatches.map(p => (
                  <button
                    key={p._id}
                    onMouseDown={(e) => { e.preventDefault(); jumpToPatient(p._id); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--overlay-subtle)]"
                    style={{ borderBottom: '1px solid var(--border-light)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {patientFullName(p)}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                        {p.hospitalNumber} · {patientGenderAge(p)}
                        {p.phone ? ` · ${formatPhoneDisplay(p.phone)}` : ''}
                      </p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" color="var(--text-muted)" />
                  </button>
                ))}
                <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--text-muted)', background: 'var(--overlay-subtle)' }}>
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="w-3 h-3" color="var(--text-muted)" />
                    {t('topbar.pressEnterToFilter')}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Clear button — pages render their own native clear is hidden via CSS */}
        {localSearch && (
          <button
            type="button"
            onClick={clear}
            aria-label={t('action.close')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--overlay-subtle)]"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        )}
      </div>
      )}

      {/* Compact control docked directly beside the search input (e.g. a filter
          icon), as opposed to the page actions pushed to the row's end. */}
      {searchTrailing && (
        <div className="flex-shrink-0">
          {searchTrailing}
        </div>
      )}
      </div>

      {/* Page action buttons — sit on the same row as the search bar. In split
          mode they fill the right grid column (right-aligned); otherwise they're
          pushed to the row's end. */}
      {actions && (
        <div className={split
          ? 'flex items-center gap-2 flex-wrap lg:justify-end'
          : 'flex items-center gap-2 flex-shrink-0 ml-auto flex-wrap'}>
          {actions}
        </div>
      )}
    </div>
  );
}
