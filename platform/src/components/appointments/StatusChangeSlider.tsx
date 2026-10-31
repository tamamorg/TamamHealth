'use client';

/**
 * Confirm a move on the visit ladder from a dashboard's status pill — as a
 * slider (on a dashboard it docks over the right panel). For the rungs that
 * are only a status (Scheduled, In progress, Rescheduled, …); check-in,
 * checkout, no-show and cancel have sliders of their own.
 */

import { useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatClockTime } from '@/lib/format-utils';
import { statusWord } from '@/lib/i18n/status-word';
import '@/components/ehr/chart/panels/start-visit-panel.css';
import type { AppointmentStatus } from '@/lib/db-types';

const EXPLAINED = new Set(['scheduled', 'in_progress', 'rescheduled']);

export default function StatusChangeSlider({ patientName, appointmentTime, from, to, needsReason, onConfirm, onClose }: {
  patientName: string;
  appointmentTime?: string;
  from?: AppointmentStatus | string;
  to: AppointmentStatus;
  /** An exit (cancel, no-show, reschedule): a reason is asked and required. */
  needsReason?: boolean;
  /** Writes the change. The slider closes once it settles. */
  onConfirm: (reason?: string) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The status as a name — "In progress", not "in progress" mid-sentence.
  const word = (status: string) => { const w = statusWord(t, status); return w.charAt(0).toUpperCase() + w.slice(1); };
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const confirm = async () => {
    setSaving(true);
    try { await onConfirm(needsReason ? reason.trim() : undefined); onClose(); } finally { setSaving(false); }
  };
  return (
    <FormSlider
      title={t('statusSlider.title')}
      subtitle={`${patientName}${appointmentTime ? ` · ${formatClockTime(appointmentTime)}` : ''}`}
      width={440}
      busy={saving}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>{t('action.cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={saving || (needsReason && !reason.trim())}>
          {t('statusSlider.confirm', { status: word(to) })}
        </button>
      </>}
    >
      <dl className="status-slider-change">
        {from && (<div><dt>{t('statusSlider.from')}</dt><dd>{word(from)}</dd></div>)}
        <div><dt>{t('statusSlider.to')}</dt><dd>{word(to)}</dd></div>
      </dl>
      <p className="status-slider-body">
        {EXPLAINED.has(to) ? t(`statusSlider.body.${to}`) : t('statusSlider.body.default', { status: statusWord(t, to) })}
      </p>
      {needsReason && (
        <label className="sv-field status-slider-reason">
          <span className="sv-label">{t('visitStatus.reasonLabel')}</span>
          <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
      )}
    </FormSlider>
  );
}
