'use client';

/**
 * Shared "category + priority + message" fields for adding a care alert.
 * Was previously duplicated between ChartSafetyActions.tsx (modal) and
 * CareAlertsBanner.tsx (inline card) — same fields, two copies of the JSX.
 * Each caller keeps its own container (modal vs. inline) and save logic;
 * this owns only the field markup.
 */

import type { CareAlertCategory } from '@/data/mock';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';

export const CARE_ALERT_CATEGORY_LABELS: Record<CareAlertCategory, string> = {
  clinical_risk: 'Clinical risk',
  safety: 'Safety',
  infection_control: 'Infection control',
  administrative: 'Administrative',
  other: 'Other',
};
const CATEGORY_OPTIONS = Object.keys(CARE_ALERT_CATEGORY_LABELS) as CareAlertCategory[];

const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' } as const;

export default function CareAlertFields({
  category,
  priority,
  message,
  onCategoryChange,
  onPriorityChange,
  onMessageChange,
  autoFocus,
}: {
  category: CareAlertCategory;
  priority: 'high' | 'normal';
  message: string;
  onCategoryChange: (category: CareAlertCategory) => void;
  onPriorityChange: (priority: 'high' | 'normal') => void;
  onMessageChange: (message: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select value={category} onChange={e => onCategoryChange(e.target.value as CareAlertCategory)}
          className="p-2 rounded-md text-[12px]" style={inputStyle}>
          {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CARE_ALERT_CATEGORY_LABELS[c]}</option>)}
        </Select>
        <Select value={priority} onChange={e => onPriorityChange(e.target.value as 'high' | 'normal')}
          className="p-2 rounded-md text-[12px]" style={inputStyle}>
          <option value="high">{t('ui.highPriority')}</option>
          <option value="normal">{t('births.optNormal')}</option>
        </Select>
      </div>
      <input
        value={message}
        onChange={e => onMessageChange(e.target.value)}
        placeholder={t('ui.alertEGHighFall')}
        className="w-full p-2 rounded-md text-[13px]" style={inputStyle}
        autoFocus={autoFocus}
      />
    </div>
  );
}
