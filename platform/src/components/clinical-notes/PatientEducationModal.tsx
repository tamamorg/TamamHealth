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
import Modal from '@/components/Modal';
import { Send, X } from '@/components/icons/lucide';
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
  const [subject, setSubject] = useState('Patient education');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!body.trim()) { setError('Enter the education content to send.'); return; }
    setError('');
    setSending(true);
    try {
      await onSend({ subject: subject.trim() || 'Patient education', body: body.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send patient education.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={onClose} width={520} labelledBy="cn-patied-title">
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 id="cn-patied-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, flex: 1 }}>
            Send Patient Education to {patientName}
          </h2>
          <button type="button" className="cn-tool" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="cn-btn" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="button" className="cn-btn cn-btn-primary" onClick={handleSend} disabled={sending}>
            <Send size={14} /> {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
