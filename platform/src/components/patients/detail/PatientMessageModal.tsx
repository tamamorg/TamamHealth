'use client';
import Modal from '@/components/Modal';
import { X } from '@/components/icons/lucide';
import { MessageSquare } from '@/components/icons/lucide';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { formatPhoneDisplay } from '@/lib/field-formats';
import { stopsClickPropagation } from '@/lib/a11y';
import type { Dispatch, SetStateAction } from 'react';
export default function PatientMessageModal({ messageSending, setShowMessageModal, patient, setMessageChannel, setMessageError, setMessageSent, messageChannel, messageTextConsent, setMessageTextConsent, t, messageSubject, setMessageSubject, messageBody, setMessageBody, messageError, messageSent, messageSentWarning, messageSentNote, sendPatientMessage }: {
  messageSending: boolean;
  setShowMessageModal: Dispatch<SetStateAction<boolean>>;
  patient: PatientDoc;
  setMessageChannel: Dispatch<SetStateAction<"app" | "sms" | "both">>;
  setMessageError: Dispatch<SetStateAction<string>>;
  setMessageSent: Dispatch<SetStateAction<boolean>>;
  messageChannel: "app" | "sms" | "both";
  messageTextConsent: boolean;
  setMessageTextConsent: Dispatch<SetStateAction<boolean>>;
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  messageSubject: string;
  setMessageSubject: Dispatch<SetStateAction<string>>;
  messageBody: string;
  setMessageBody: Dispatch<SetStateAction<string>>;
  messageError: string;
  messageSent: boolean;
  messageSentWarning: boolean;
  messageSentNote: string;
  sendPatientMessage: () => Promise<void>;
}) {
  return (
        <Modal variant="slider" className="tamam-dialog" onClose={() => !messageSending && setShowMessageModal(false)} width={500} labelledBy="patient-message-title">
          <div className="modal-content card-elevated p-5 w-full" {...stopsClickPropagation}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 id="patient-message-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {t('ptDetail.messagePatient')}
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {patientFullName(patient)}{patient.phone ? ` · ${formatPhoneDisplay(patient.phone)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMessageModal(false)}
                className="p-1.5 rounded-lg"
                disabled={messageSending}
                style={{ background: 'var(--overlay-subtle)' }}
                aria-label="Close patient message"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Channel</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['app', 'sms', 'both'] as const).map(channel => (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => { setMessageChannel(channel); setMessageError(''); setMessageSent(false); }}
                      className="btn btn-sm"
                      style={{
                        background: messageChannel === channel ? 'var(--tamamhealth-blue)' : 'var(--bg-secondary)',
                        color: messageChannel === channel ? '#fff' : 'var(--text-primary)',
                        border: '1px solid var(--border-light)',
                      }}
                    >
                      {channel === 'app' ? 'App' : channel === 'sms' ? 'SMS' : 'App + SMS'}
                    </button>
                  ))}
                </div>
                {messageChannel !== 'app' && (
                  <label
                    className="flex items-start gap-2 mt-2 text-[12px]"
                    style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 500, color: 'var(--text-primary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={messageTextConsent}
                      onChange={e => { setMessageTextConsent(e.target.checked); setMessageError(''); }}
                      style={{ width: 'auto', marginTop: 2 }}
                    />
                    <span>{t('patientText.consent')}</span>
                  </label>
                )}
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Subject</label>
                <input
                  value={messageSubject}
                  onChange={e => { setMessageSubject(e.target.value); setMessageSent(false); }}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Message</label>
                <textarea
                  autoFocus
                  value={messageBody}
                  onChange={e => { setMessageBody(e.target.value); setMessageError(''); setMessageSent(false); }}
                  rows={4}
                  placeholder="Write a clear patient instruction or follow-up message."
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              {messageError && <p className="text-[12px]" role="alert" style={{ color: 'var(--color-danger-text)' }}>{messageError}</p>}
              {messageSent && <p className="text-[12px] font-semibold" role="status" style={{ color: messageSentWarning ? 'var(--color-warning-text)' : 'var(--color-success-text)' }}>{messageSentNote || 'Message saved.'}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button type="button" onClick={() => setShowMessageModal(false)} className="btn btn-sm btn-secondary" disabled={messageSending}>Close</button>
              <button type="button" onClick={sendPatientMessage} className="btn btn-sm btn-primary" disabled={messageSending || !messageBody.trim()}>
                <MessageSquare className="w-3.5 h-3.5" /> {messageSending ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        </Modal>
  );
}
