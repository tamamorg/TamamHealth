'use client';

/**
 * "Correction awaiting review": the value a lab tech has proposed for a filed
 * result, shown beside it on every staff screen until a second lab tech
 * approves or rejects it. Staff only — the patient portal and printed reports
 * show the filed value alone, so this never sits inside a print area.
 */

import { AlertTriangle } from '@/components/icons/lucide';
import { formatDateTime } from '@/lib/format-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultCorrection } from '@/lib/db-types';
import { resultWithUnit } from './lab-workflow-types';
import './pending-correction.css';

export default function PendingCorrectionNotice({ correction, compact = false, showValue = true, children }: {
  correction: LabResultCorrection;
  /** One line, for list rows. */
  compact?: boolean;
  /** Compact only: false on a list that never shows result values. */
  showValue?: boolean;
  /** The reviewer's actions, under the details. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const value = resultWithUnit(correction.result, correction.unit) || '—';
  if (compact) {
    return (
      // Short on the row; the whole line (value, who, why) on hover and for
      // screen readers. The report in the slider spells it out.
      <span
        className="lab-pcorr lab-pcorr--compact"
        title={t('labFlow.correctionLine', { value, by: correction.proposedBy, reason: correction.reason })}
        aria-label={t('labFlow.correctionLine', { value, by: correction.proposedBy, reason: correction.reason })}
      >
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
        {showValue
          ? t('labFlow.correctionPendingValue', { value })
          : t('labFlow.correctionAwaiting')}
      </span>
    );
  }
  return (
    <div className="lab-pcorr" role="status">
      <p className="lab-pcorr-head">
        <AlertTriangle className="w-4 h-4" aria-hidden /> {t('labFlow.correctionAwaiting')}
      </p>
      <dl className="lab-pcorr-fields">
        <div><dt>{t('labFlow.correctionProposedValue')}</dt><dd>{value}</dd></div>
        <div><dt>{t('labFlow.reason')}</dt><dd>{correction.reason || '—'}</dd></div>
        <div><dt>{t('labFlow.correctionProposedBy')}</dt><dd>{correction.proposedBy} · {formatDateTime(correction.proposedAt)}</dd></div>
      </dl>
      <p className="lab-pcorr-help">{t('labFlow.correctionFiledStands')}</p>
      {children}
    </div>
  );
}
