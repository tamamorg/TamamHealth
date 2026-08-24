'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import Select from '@/components/Select';

export type ReferralFilterState = { patient: string; route: string; department: string; urgency: string; status: string };

/** How many axes are narrowing the list — drives the field's applied badge. */
export function referralFilterCount(filters: ReferralFilterState): number {
  return Object.values(filters).filter(Boolean).length;
}

/**
 * The referral list's filter axes — patient, route, department, urgency, status.
 *
 * This used to be a self-contained "Filters" button with its own popover, its
 * own outside-click and Escape handling, and its own filter icon, docked beside
 * the search bar. Two controls sat in that toolbar and both narrowed the same
 * list; the icon-only one named none of the axes below.
 *
 * It is now just the fields. `EhrSearchFilter` owns the disclosure, the panel
 * and the applied count, so this renders the part that is actually about
 * referrals and nothing about how a popover behaves.
 */
export default function ReferralFilterFields({
  filters,
  setFilter,
  urgencyOptions,
  statusOptions,
}: {
  filters: ReferralFilterState;
  setFilter: (k: keyof ReferralFilterState, v: string) => void;
  urgencyOptions: { v: string; l: string }[];
  statusOptions: { v: string; l: string }[];
}) {
  const { t } = useTranslation();
  const fieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

  return (
    <div className="flex flex-col gap-3">
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
  );
}
