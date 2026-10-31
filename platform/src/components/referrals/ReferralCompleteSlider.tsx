'use client';

/**
 * Close a referral with its outcome — the receiving facility's last step, and
 * what goes back to the clinician who asked. One form for the /referrals
 * worklist and the patient chart's referrals list.
 */

import { useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ReferralDisposition, ReferralOutcome } from '@/data/mock';
import '@/components/ehr/chart/panels/start-visit-panel.css';

const DISPOSITIONS: ReferralDisposition[] = [
  'treated_discharged', 'admitted', 'referred_onward', 'did_not_arrive', 'deceased',
];

export default function ReferralCompleteSlider({ recordedBy, onComplete, onClose }: {
  recordedBy: string;
  /** Files the outcome; a throw leaves the form open with its answers. */
  onComplete: (outcome: ReferralOutcome) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [disposition, setDisposition] = useState<ReferralDisposition>('treated_discharged');
  const [summary, setSummary] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!summary.trim()) return;
    setSaving(true);
    try {
      await onComplete({
        disposition,
        summary: summary.trim(),
        followUp: followUp.trim() || undefined,
        recordedBy,
        recordedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSlider
      title={t('referrals.completeReferral')}
      onClose={onClose}
      busy={saving}
      footer={<>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={saving}>{t('action.cancel')}</button>
        <button type="button" onClick={() => void save()} className="btn btn-primary" disabled={saving || !summary.trim()}>
          {saving ? t('referrals.completing') : t('referrals.markComplete')}
        </button>
      </>}
    >
      <div className="sv-root sv-root--slider space-y-4">
        <p className="sv-label">{t('referrals.completeHint')}</p>
        <label className="sv-field">
          <span className="sv-label">{t('referrals.outcomeDisposition')}</span>
          <Select value={disposition} onChange={e => setDisposition(e.target.value as ReferralDisposition)}>
            {DISPOSITIONS.map(d => <option key={d} value={d}>{t(`referrals.disposition_${d}`)}</option>)}
          </Select>
        </label>
        <label className="sv-field">
          <span className="sv-label field-required">{t('referrals.outcomeSummary')}</span>
          <textarea rows={3} value={summary} onChange={e => setSummary(e.target.value)} placeholder={t('referrals.completePlaceholder')} />
        </label>
        <label className="sv-field">
          <span className="sv-label">{t('referrals.outcomeFollowUp')}</span>
          <textarea rows={2} value={followUp} onChange={e => setFollowUp(e.target.value)} placeholder={t('referrals.outcomeFollowUpPlaceholder')} />
        </label>
      </div>
    </FormSlider>
  );
}
