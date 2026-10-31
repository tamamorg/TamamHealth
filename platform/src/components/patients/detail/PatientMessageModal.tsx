'use client';
import { useEffect } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { FormError } from '@/components/overlay/FormNotices';
import { useToast } from '@/components/Toast';
import { MessageSquare } from '@/components/icons/lucide';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { formatPhoneDisplay } from '@/lib/field-formats';
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
  const { showToast } = useToast();
  useEffect(() => {
    if (messageSent) showToast(messageSentNote || 'Message saved.', messageSentWarning ? 'warning' : 'success', { placement: 'corner' });
  }, [messageSent, messageSentNote, messageSentWarning, showToast]);

  return (
        <FormSlider
          title={t('ptDetail.messagePatient')}
          subtitle={<>{patientFullName(patient)}{patient.phone ? ` · ${formatPhoneDisplay(patient.phone)}` : ''}</>}
          className="tamam-dialog"
          width={500}
          onClose={() => !messageSending && setShowMessageModal(false)}
          footer={<>
              <button type="button" onClick={() => setShowMessageModal(false)} className="btn btn-secondary" disabled={messageSending}>Close</button>
              <button type="button" onClick={sendPatientMessage} className="btn btn-primary" disabled={messageSending || !messageBody.trim()}>
                <MessageSquare className="w-3.5 h-3.5" /> {messageSending ? 'Sending…' : 'Send message'}
              </button>
          </>}
        >
          <div className="space-y-4">
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
              {messageError && <FormError message={messageError} />}
            </div>
          </div>
        </FormSlider>
  );
}
