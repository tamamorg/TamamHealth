'use client';

/**
 * Send a platform-composed document — a prescription, a visit summary — to
 * the patient's phone as a text message.
 *
 * The sender sees exactly what will be sent and to which number, can edit it,
 * and must confirm the patient agreed: a text is neither encrypted nor
 * recallable, and the number on file is often a phone several people share.
 *
 * What happened is reported in the sender's terms, because the four outcomes
 * call for four different next steps (see `patient-text-service`): it went;
 * it will go when the connection returns; this facility cannot send texts at
 * all; or the gateway refused it.
 */
import { useId, useState, type ReactNode } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import InlineBanner, { type BannerTone } from '@/components/overlay/InlineBanner';
import FormField from '@/components/overlay/FormField';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatPhoneDisplay } from '@/lib/field-formats';
import { MAX_PATIENT_TEXT_LENGTH, smsSegments, toSmsSafe } from '@/lib/sms/text';
import type { MessageDoc } from '@/lib/db-types';
import type { PatientTextOutcome, PatientTextResult } from '../services/patient-text-service';
import './patient-text.css';

export interface PatientTextDialogProps {
  patient: { _id: string; name: string; phone?: string };
  sender: { _id: string; name: string; hospitalId?: string; hospitalName?: string; orgId?: string };
  title: string;
  /** Subject line of the message saved to the patient's record. */
  subject: string;
  kind: NonNullable<MessageDoc['messageKind']>;
  /** The composed text. Changing it (an option toggled) resets the editor. */
  text: string;
  /** Prescriptions this text carries, recorded as given once it is sent. */
  prescriptionIds?: string[];
  /** Shown above the editor — e.g. which items were left off the text. */
  notice?: ReactNode;
  /** Controls that change the composed text — e.g. "include the diagnosis". */
  options?: ReactNode;
  onClose: () => void;
  onDone?: (result: PatientTextResult) => void;
}

const OUTCOME_TONE: Record<PatientTextOutcome, BannerTone> = {
  sent: 'success',
  queued: 'info',
  not_connected: 'warning',
  failed: 'danger',
};

export default function PatientTextDialog({
  patient, sender, title, subject, kind, text, prescriptionIds, notice, options, onClose, onDone,
}: PatientTextDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descId = useId();
  // The sender's edit, kept only while the composed text it was made against
  // is unchanged — toggling an option recomposes the text and starts afresh.
  const [edit, setEdit] = useState<{ base: string; value: string } | null>(null);
  const draft = edit && edit.base === text ? edit.value : text;
  const setDraft = (value: string) => setEdit({ base: text, value });
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PatientTextResult | null>(null);

  const phone = (patient.phone || '').trim();
  const shownPhone = phone ? formatPhoneDisplay(phone) : '';
  const body = toSmsSafe(draft);
  const info = smsSegments(body);
  const over = body.length > MAX_PATIENT_TEXT_LENGTH;
  const canSend = Boolean(phone) && body.length > 0 && !over && consent && !sending && !result;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const { sendPatientText } = await import('@/modules/communication/services/patient-text-service');
      const outcome = await sendPatientText({
        patient,
        text: body,
        subject,
        kind,
        sender,
        consentConfirmed: true,
        prescriptionIds,
      });
      setResult(outcome);
      onDone?.(outcome);
    } catch (err) {
      // The message could not even be written to the device.
      setResult({
        message: {} as MessageDoc,
        outcome: 'failed',
        error: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSending(false);
    }
  };

  const outcomeText = result ? {
    sent: t('patientText.outcomeSent', { phone: shownPhone }),
    queued: t('patientText.outcomeQueued'),
    not_connected: t('patientText.outcomeNotConnected'),
    failed: t('patientText.outcomeFailed', { reason: result.error || t('patientText.reasonUnknown') }),
  }[result.outcome] : '';

  return (
    <Modal onClose={() => { if (!sending) onClose(); }} size="md" labelledBy={titleId} describedBy={descId}>
      <DialogFrame busy={sending} busyLabel={t('patientText.sending')}>
        <DialogHeader
          titleId={titleId}
          descriptionId={descId}
          title={title}
          description={shownPhone
            ? t('patientText.recipient', { name: patient.name, phone: shownPhone })
            : patient.name}
          onClose={onClose}
        />
        <DialogBody>
          <div className="ptx-stack">
            {result && (
              <InlineBanner tone={OUTCOME_TONE[result.outcome]} title={t(`patientText.outcomeTitle.${result.outcome}`)}>
                {outcomeText}
              </InlineBanner>
            )}
            {!phone && (
              <InlineBanner tone="danger" title={t('patientText.noPhoneTitle')}>
                {t('patientText.noPhoneBody')}
              </InlineBanner>
            )}
            {!result && notice}
            {!result && options}
            <FormField label={t('patientText.messageLabel')} hint={result ? undefined : t('patientText.messageHint')}>
              {control => (
                <textarea
                  {...control}
                  className="ptx-body"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  readOnly={Boolean(result)}
                  rows={8}
                />
              )}
            </FormField>
            <p className="ptx-count" data-over={over || undefined}>
              <span>{t('patientText.count', { length: body.length, max: MAX_PATIENT_TEXT_LENGTH })}</span>
              <span>
                {t(info.segments === 1 ? 'patientText.segmentsOne' : 'patientText.segmentsMany', { count: info.segments })}
                {info.encoding === 'ucs2' ? ` · ${t('patientText.specialCharacters')}` : ''}
              </span>
            </p>
            {!result && (
              <>
                <label className="ptx-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={e => setConsent(e.target.checked)}
                    disabled={!phone}
                  />
                  <span>{t('patientText.consent')}</span>
                </label>
                <p className="ptx-privacy">{t('patientText.privacy')}</p>
              </>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          {result ? (
            <button type="button" className="btn btn-primary" onClick={onClose} data-modal-initial-focus>
              {t('patientText.done')}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sending}>
                {t('action.cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={!canSend}>
                {t('patientText.send')}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
