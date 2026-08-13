'use client';

/**
 * Step 3 — Clinical. Collection logistics plus the Ask-at-Order-Entry
 * questions the selected tests demand. Required questions are marked and
 * highlighted exactly as the Next button judges them, so "* required" and
 * "why can't I continue" always agree.
 */

import { AlertTriangle, CheckCircle2 } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { aoeKey, timingLabelKey, type AoeQuestion, type CollectionTiming, type FastingState, type LabOrderPriority } from '../lab-order-types';
import type { LabOrderController } from '../useLabOrderDraft';
import Select from '@/components/Select';

function AoeField({
  testName,
  question,
  value,
  missing,
  onChange,
}: {
  testName: string;
  question: AoeQuestion;
  value: string;
  missing: boolean;
  onChange: (value: string) => void;
}) {
  const id = `labord-aoe-${testName.replace(/\W+/g, '-')}-${question.id}`;
  const common = {
    id,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(e.target.value),
  };

  return (
    <div className={missing ? 'labord-missing' : undefined}>
      <label htmlFor={id}>
        {question.label}{question.required && <span className="labord-required"> *</span>}
      </label>
      {question.type === 'select' ? (
        <Select {...common}>
          <option value="">—</option>
          {(question.options || []).map(option => <option key={option} value={option}>{option}</option>)}
        </Select>
      ) : (
        <input type={question.type === 'number' ? 'number' : question.type === 'date' ? 'date' : 'text'} {...common} />
      )}
      {question.help && <p className="labord-help">{question.help}</p>}
    </div>
  );
}

export default function ClinicalStep({ controller }: { controller: LabOrderController }) {
  const { t } = useTranslation();
  const { draft, patch, setAoe, schedule, missingAoe } = controller;
  const isMissing = (testName: string, questionId: string) =>
    missingAoe.some(entry => entry.testName === testName && entry.questionId === questionId);

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">
          {draft.kind === 'imaging' ? t('labOrder.scheduling') : t('labOrder.collection')}
        </div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <div>
              <label htmlFor="labord-priority">{t('labOrder.priority')}</label>
              <Select id="labord-priority" value={draft.priority} onChange={e => patch({ priority: e.target.value as LabOrderPriority })}>
                <option value="routine">{t('appointments.priorityRoutine')}</option>
                <option value="urgent">{t('appointments.priorityUrgent')}</option>
                <option value="stat">{t('lab.priorityStat')}</option>
              </Select>
              {draft.priority === 'stat' && <p className="labord-help">{t('labOrder.statHelp')}</p>}
            </div>
            <div>
              <label htmlFor="labord-timing">
                {draft.kind === 'imaging' ? t('labOrder.studyTiming') : t('labOrder.collectionTiming')}
              </label>
              <Select id="labord-timing" value={draft.collectionTiming} onChange={e => patch({ collectionTiming: e.target.value as CollectionTiming })}>
                {(['draw_now', 'lab_collect', 'future'] as CollectionTiming[]).map(timing => (
                  <option key={timing} value={timing}>{t(timingLabelKey(draft.kind, timing))}</option>
                ))}
              </Select>
            </div>
            {draft.collectionTiming === 'future' && (
              <div>
                <label htmlFor="labord-scheduled">{t('labOrder.scheduledFor')}</label>
                <input
                  id="labord-scheduled"
                  type="datetime-local"
                  value={draft.scheduledCollectionAt}
                  onChange={e => patch({ scheduledCollectionAt: e.target.value })}
                />
              </div>
            )}
            <div>
              <label htmlFor="labord-fasting">{t('labOrder.fastingState')}</label>
              <Select id="labord-fasting" value={draft.fasting} onChange={e => patch({ fasting: e.target.value as FastingState })}>
                <option value="unknown">{t('labOrder.fastingUnknown')}</option>
                <option value="yes">{t('labOrder.fastingYes')}</option>
                <option value="no">{t('labOrder.fastingNo')}</option>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">
          <span>{t('labOrder.aoeHeading')}</span>
          {missingAoe.length > 0
            ? (
              <span className="labord-required" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                {t('labOrder.aoeMissing', { count: missingAoe.length })}
              </span>
            )
            : schedule.length > 0 && (
              <span className="labord-pick-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-success, #059669)' }}>
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                {t('labOrder.aoeComplete')}
              </span>
            )}
        </div>
        <div className="labord-section-body">
          {schedule.length === 0 && <p className="labord-help" style={{ margin: 0 }}>{t('labOrder.aoeNone')}</p>}
          {schedule.map(({ test, questions }) => (
            <div key={test.name} className="labord-aoe-block">
              <div className="labord-aoe-title">
                {test.name}
                <span className="labord-pick-meta">({test.specimen})</span>
              </div>
              <div className="labord-grid-2">
                {questions.map(question => (
                  <AoeField
                    key={question.id}
                    testName={test.name}
                    question={question}
                    value={draft.aoe[aoeKey(test.name, question.id)] || ''}
                    missing={isMissing(test.name, question.id)}
                    onChange={value => setAoe(test.name, question.id, value)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
