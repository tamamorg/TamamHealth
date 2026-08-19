'use client';

/**
 * Step 5 — Review. Everything about to be committed, on one page, with a jump
 * back to whichever step owns each block. This is the last point where the
 * order is still a draft, so it repeats the AOE answers verbatim rather than
 * summarising them.
 */

import { AlertTriangle, Pencil } from '@/components/icons/lucide';
import FileUpload from '@/components/FileUpload';
import { patientAgeLabel, patientFullName } from '@/lib/patient-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { aoeKey, timingLabelKey, type LabOrderStepKey } from '../lab-order-types';
import { specimenSummary } from '../lab-order-catalog';
import type { LabOrderController } from '../useLabOrderDraft';

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="labord-btn labord-btn--ghost" onClick={onClick} style={{ padding: '2px 8px' }}>
      <Pencil className="w-3.5 h-3.5" aria-hidden /> {label}
    </button>
  );
}

export default function ReviewStep({
  controller,
  onEditStep,
}: {
  controller: LabOrderController;
  onEditStep: (step: LabOrderStepKey) => void;
}) {
  const { t } = useTranslation();
  const { draft, patch, patient, schedule } = controller;
  const specimens = specimenSummary(draft.tests);

  const priorityLabel = draft.priority === 'stat'
    ? t('lab.priorityStat')
    : draft.priority === 'urgent' ? t('appointments.priorityUrgent') : t('appointments.priorityRoutine');

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">
          <span>{t('labOrder.patient')}</span>
          <EditButton label={t('action.edit')} onClick={() => onEditStep('patient')} />
        </div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <div>
              <span className="labord-field-label">{t('labOrder.fieldName')}</span>
              <span className="labord-field-value">{patient ? patientFullName(patient) : '—'}</span>
            </div>
            <div>
              <span className="labord-field-label">{t('labOrder.fieldAgeSex')}</span>
              <span className="labord-field-value">{patient ? `${patientAgeLabel(patient)} · ${patient.gender || '—'}` : '—'}</span>
            </div>
            <div>
              <span className="labord-field-label">{t('labOrder.orderingProvider')}</span>
              <span className="labord-field-value">{draft.orderedByName || '—'}</span>
            </div>
            <div>
              <span className="labord-field-label">{t('labOrder.processing')}</span>
              <span className="labord-field-value">
                {draft.processing === 'send_out' ? t('labOrder.processingSendOut') : t('labOrder.processingInHouse')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">
          <span>{t('labOrder.diagnoses')}</span>
          <EditButton label={t('action.edit')} onClick={() => onEditStep('diagnosis')} />
        </div>
        <div className="labord-section-body">
          <div className="labord-chip-row">
            {draft.indications.map(indication => (
              <span key={indication.code} className="labord-chip"><code>{indication.code}</code> {indication.title}</span>
            ))}
            {draft.indications.length === 0 && <span className="labord-help">{t('labOrder.noDiagnosesYet')}</span>}
          </div>
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">
          <span>{draft.kind === 'imaging' ? t('labOrder.studies') : t('labOrder.tests')}</span>
          <EditButton label={t('action.edit')} onClick={() => onEditStep('tests')} />
        </div>
        <div className="labord-section-body" style={{ padding: 0 }}>
          {draft.tests.map((test, i) => (
            <div key={test.name} className="labord-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="labord-row-index">{i + 1}.</span>
                <span className="labord-pick-name">{test.name}</span>
              </span>
              <span className="labord-pick-meta">{test.specimen}{test.loinc ? ` · LOINC ${test.loinc}` : ''}</span>
            </div>
          ))}
          {draft.tests.length === 0 && <div className="labord-row"><span className="labord-help">{t('labOrder.noTestsYet')}</span></div>}
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">
          <span>{draft.kind === 'imaging' ? t('labOrder.scheduling') : t('labOrder.collection')}</span>
          <EditButton label={t('action.edit')} onClick={() => onEditStep('clinical')} />
        </div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <div>
              <span className="labord-field-label">{t('labOrder.priority')}</span>
              <span className="labord-field-value">{priorityLabel}</span>
            </div>
            <div>
              <span className="labord-field-label">
                {draft.kind === 'imaging' ? t('labOrder.studyTiming') : t('labOrder.collectionTiming')}
              </span>
              <span className="labord-field-value">
                {t(timingLabelKey(draft.kind, draft.collectionTiming))}
                {draft.collectionTiming === 'future' && draft.scheduledCollectionAt
                  ? ` — ${draft.scheduledCollectionAt.replace('T', ' ')}`
                  : ''}
              </span>
            </div>
            <div>
              <span className="labord-field-label">{t('labOrder.fastingState')}</span>
              <span className="labord-field-value">
                {draft.fasting === 'yes' ? t('labOrder.fastingYes') : draft.fasting === 'no' ? t('labOrder.fastingNo') : t('labOrder.fastingUnknown')}
              </span>
            </div>
            <div>
              <span className="labord-field-label">{t('labOrder.specimens')}</span>
              <span className="labord-field-value">
                {specimens.length ? specimens.map(s => `${s.specimen} ×${s.count}`).join(' · ') : '—'}
              </span>
            </div>
          </div>

          {schedule.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span className="labord-field-label">{t('labOrder.aoeHeading')}</span>
              {schedule.map(({ test, questions }) => (
                <div key={test.name} className="labord-aoe-block">
                  <div className="labord-aoe-title">{test.name}</div>
                  {questions.map(question => (
                    <div key={question.id} className="labord-row" style={{ paddingInlineStart: 0 }}>
                      <span className="labord-pick-meta">{question.label}</span>
                      <span className="labord-field-value">{draft.aoe[aoeKey(test.name, question.id)] || '—'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">{t('labOrder.testSpecificInfo')}</div>
        <div className="labord-section-body" style={{ padding: 0 }}>
          {draft.tests.map(test => {
            const questions = schedule.find(entry => entry.test.name === test.name)?.questions || [];
            const answered = questions.filter(q => (draft.aoe[aoeKey(test.name, q.id)] || '').trim());
            // Only required blanks are a problem — an optional question left
            // empty is a judgement call the clinician already made.
            const missingRequired = questions.filter(
              q => q.required && !(draft.aoe[aoeKey(test.name, q.id)] || '').trim(),
            );
            return (
              <div key={test.name} className="labord-numbered-row">
                <span className="labord-numbered-body">
                  <span className="labord-pick-name">{test.name}</span>
                  <span className="labord-check-meta">
                    {questions.length === 0
                      ? t('labOrder.noExtraInfo')
                      : t('labOrder.answeredCount', { answered: answered.length, total: questions.length })}
                  </span>
                </span>
                {missingRequired.length > 0 && (
                  <button
                    type="button"
                    className="labord-btn labord-btn--ghost"
                    style={{ padding: '2px 8px' }}
                    onClick={() => onEditStep('clinical')}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-warning, #D97706)' }} aria-hidden />
                    {t('labOrder.completeInfo')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">{t('labOrder.documents')}</div>
        <div className="labord-section-body">
          <p className="labord-help" style={{ marginTop: 0 }}>{t('labOrder.documentsHelp')}</p>
          <FileUpload
            attachments={draft.documents}
            onAdd={attachment => patch({ documents: [...draft.documents, attachment] })}
            onRemove={id => patch({ documents: draft.documents.filter(file => file.id !== id) })}
            uploaderName={draft.orderedByName || ''}
            maxFiles={5}
          />
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">{t('labOrder.notesAndComments')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <div>
              <label htmlFor="labord-notes">{t('labOrder.notesToLab')}</label>
              <textarea
                id="labord-notes"
                rows={3}
                value={draft.notes}
                onChange={e => patch({ notes: e.target.value })}
                placeholder={t('lab.clinicalNotesPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="labord-comments">{t('labOrder.internalComment')}</label>
              <textarea
                id="labord-comments"
                rows={3}
                value={draft.comments}
                onChange={e => patch({ comments: e.target.value })}
                placeholder={t('labOrder.internalCommentPlaceholder')}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
