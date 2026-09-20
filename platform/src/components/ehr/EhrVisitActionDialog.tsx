'use client';

/**
 * The dialog behind the visit panel's More menu exits — Return to front desk,
 * Left without being seen, Escalate to emergency care.
 *
 * These three used to be the browser's own `confirm()` / `prompt()`: a grey
 * system box with no patient context, no way to say why, and nothing in common
 * with the Move dialog that opens from the same menu. They are now one dialog
 * in the Move dialog's own kit (`ehr-queue-move`), so every entry under More
 * opens the same shape: a titled head, what the action does, the choice, a
 * comment kept on the record, and Cancel / commit in the footer.
 *
 * The reason is a pick plus an optional comment rather than a bare text box:
 * the same three or four reasons account for nearly every use, a tap is faster
 * than typing at a busy desk, and reception reads the result in its feed.
 */

import { useState } from 'react';
import { X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { shortenPersonName } from '@/lib/patient-utils';

export type VisitActionKind = 'return_to_desk' | 'lwbs' | 'escalate';

const ACTIONS: Record<VisitActionKind, {
  title: string;
  note: string;
  reasons: string[];
  submit: string;
  saving: string;
  /** Closes or hands off the visit for good — the commit button says so. */
  danger: boolean;
}> = {
  return_to_desk: {
    title: 'visitActions.returnTitle',
    note: 'visitActions.returnNote',
    reasons: ['visitActions.reasonSteppedOut', 'visitActions.reasonRebook', 'visitActions.reasonWrongProvider'],
    submit: 'visitActions.returnSubmit',
    saving: 'visitActions.returnSaving',
    danger: false,
  },
  lwbs: {
    title: 'visitActions.lwbsTitle',
    note: 'visitActions.lwbsNote',
    reasons: ['visitActions.reasonCouldNotWait', 'visitActions.reasonNoAnswer', 'visitActions.reasonWentElsewhere'],
    submit: 'visitActions.lwbsSubmit',
    saving: 'visitActions.lwbsSaving',
    danger: true,
  },
  escalate: {
    title: 'visitActions.escalateTitle',
    note: 'visitActions.escalateNote',
    reasons: [],
    submit: 'visitActions.escalateSubmit',
    saving: 'visitActions.escalating',
    danger: true,
  },
};

export default function EhrVisitActionDialog({ kind, patientName, saving, onClose, onConfirm }: {
  kind: VisitActionKind;
  patientName: string;
  saving: boolean;
  onClose: () => void;
  /** The reason as it should be recorded: the pick, then the comment. */
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const action = ACTIONS[kind];
  const name = shortenPersonName(patientName) || patientName;
  const [reasonKey, setReasonKey] = useState<string>('');
  const [comment, setComment] = useState('');

  const reason = [reasonKey ? t(reasonKey) : '', comment.trim()].filter(Boolean).join(' — ');

  return (
    <Modal onClose={onClose} width={520} labelledBy="ehr-visit-action-title">
      <div className="modal-content card-elevated ehr-queue-move">
        <div className="ehr-queue-move-head">
          <h3 id="ehr-visit-action-title">{t(action.title, { name })}</h3>
          <button type="button" aria-label={t('action.close')} onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <p className={action.danger ? 'ehr-queue-move-escalate-note' : 'ehr-queue-move-note'} role="note">
          {t(action.note, { name })}
        </p>

        {action.reasons.length > 0 && (
          <fieldset>
            <legend>{t('visitActions.reasonLegend')}</legend>
            {action.reasons.map(key => (
              <label key={key} className="ehr-queue-move-option">
                <input
                  type="radio"
                  name="visit-action-reason"
                  checked={reasonKey === key}
                  onChange={() => setReasonKey(key)}
                />
                <span>{t(key)}</span>
              </label>
            ))}
            <label className="ehr-queue-move-option">
              <input
                type="radio"
                name="visit-action-reason"
                checked={reasonKey === ''}
                onChange={() => setReasonKey('')}
              />
              <span>{t('visitActions.reasonOther')}</span>
            </label>
          </fieldset>
        )}

        <label className="ehr-queue-move-comment">
          <span>{t('visitActions.commentLabel')}</span>
          <textarea
            rows={3}
            value={comment}
            placeholder={t('visitActions.commentPlaceholder')}
            onChange={event => setComment(event.target.value)}
          />
        </label>

        <div className="ehr-queue-move-footer">
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button
            type="button"
            className={action.danger ? 'primary danger' : 'primary'}
            disabled={saving}
            onClick={() => onConfirm(reason)}
          >
            {saving ? t(action.saving) : t(action.submit)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
