'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';

/** Shared operational context shown in appointment and queue detail drawers. */
export default function EhrWorkItemProgress({
  status,
  owner,
  waiting,
  timeLabel = 'Waiting',
  nextAction,
}: {
  status?: string;
  owner?: string;
  waiting?: string;
  timeLabel?: string;
  nextAction?: string;
}) {
  const { t } = useTranslation();
  const stages = ['Registration', 'Triage', 'Consultation', 'Orders', 'Follow-up'];
  const normalizedStatus = (status || '').toLowerCase();
  const currentStage = normalizedStatus.includes('follow') || normalizedStatus.includes('complete')
    ? 4
    : normalizedStatus.includes('order') || normalizedStatus.includes('result') || normalizedStatus.includes('prescription')
      ? 3
      : normalizedStatus.includes('consult') || normalizedStatus.includes('room') || normalizedStatus.includes('progress')
        ? 2
        : normalizedStatus.includes('triage') || normalizedStatus.includes('ready') || normalizedStatus.includes('check')
          ? 1
          : 0;
  const items = [
    { label: 'Owner', value: owner },
    { label: timeLabel, value: waiting },
    { label: 'Next action', value: nextAction },
  ].filter(item => item.value && item.value !== '—');

  if (items.length === 0) return null;

  return (
    <section className="ehr-work-item-progress" aria-label={t('ui.careProgress')}>
      <div className="ehr-work-item-progress__title">{t('ui.careProgress')}</div>
      <div className="ehr-work-item-progress__stages" aria-label={`Current stage: ${stages[currentStage]}`}>
        {stages.map((stage, index) => (
          <div key={stage} className={`ehr-work-item-progress__stage ${index < currentStage ? 'is-complete' : ''} ${index === currentStage ? 'is-current' : ''}`}>
            <span className="ehr-work-item-progress__stage-dot" aria-hidden="true">{index < currentStage ? '✓' : index + 1}</span>
            <span>{stage}</span>
          </div>
        ))}
      </div>
      <div className="ehr-work-item-progress__grid">
        {items.map(item => (
          <div key={item.label} className="ehr-work-item-progress__item">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
