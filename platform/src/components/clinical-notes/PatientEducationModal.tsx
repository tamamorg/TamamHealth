'use client';

/**
 * Send Patient Education — closes the note's "patient_education" plan action
 * with a real message instead of the dead hand-off to /messages (which reads
 * neither `patientId` nor `kind`, so nothing there ever fired).
 *
 * The chart's own patient-education flow already exists and works — the
 * ChartHeader "Patient education" action opens the chart's message composer
 * with `subject: 'Patient education'` and `patientEducation: true` set, which
 * files the sent message under Documents ▸ Patient education
 * (src/app/(dashboard)/patients/[id]/page.tsx sendPatientMessage /
 * onPatientEd). This modal collects the same two fields from inside the note;
 * ClinicalNoteEditor's handleSendEducation sends it with that identical flag
 * shape so it lands in the same place.
 */

import { useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { Send } from '@/components/icons/lucide';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import './clinical-notes.css';

export interface PatientEducationModalResult {
  subject: string;
  body: string;
}

interface PatientEducationModalProps {
  patientName: string;
  onSend: (result: PatientEducationModalResult) => Promise<void> | void;
  onClose: () => void;
}

export default function PatientEducationModal({
  patientName, onSend, onClose,
}: PatientEducationModalProps) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('Patient education');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!body.trim()) { setError(t('msg.enterTheEducationContentTo')); return; }
    setError('');
    setSending(true);
    try {
      await onSend({ subject: subject.trim() || 'Patient education', body: body.trim() });
      onClose();
    } catch (err) {
      setError(describeError(err, t('msg.patientEducationNotSentTry')));
    } finally {
      setSending(false);
    }
  };

  return (
    <FormSlider
      title={<>Send Patient Education to {patientName}</>}
      width={520}
      onClose={onClose}
      footer={<>
          <button type="button" className="cn-btn" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="button" className="cn-btn cn-btn-primary" onClick={handleSend} disabled={sending}>
            <Send size={14} /> {sending ? 'Sending…' : 'Send'}
          </button>
      </>}
    >
      <div className="space-y-4">
        <p style={{ fontSize: 13, color: 'var(--color-text-muted, #5d728b)', margin: '0 0 14px' }}>
          Sent as a message to the patient and filed under the chart&rsquo;s Documents ▸ Patient education.
        </p>

        <label className="cn-field" style={{ marginBottom: 12, width: '100%' }}>
          <span className="cn-label" style={{ minWidth: 68 }}>Subject</span>
          <input
            className="cn-input"
            style={{ flex: 1 }}
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
        </label>

        <textarea
          className="cn-textarea"
          style={{ minHeight: 140 }}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What the patient should know…"
          aria-label="Patient education content"
          autoFocus
        />

        {error && (
          <p style={{ color: 'var(--color-danger, #d92b20)', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>
        )}
      </div>
    </FormSlider>
  );
}
