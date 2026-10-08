'use client';

/**
 * Messages tab content — the conversation between this patient and the people
 * caring for them, on the chart where the rest of their care is.
 *
 * Clinicians could already send a message into the patient's portal inbox, and
 * the patient could already write back from the portal. What was missing was
 * anywhere on the staff side to read the reply: it arrived as a front-desk
 * enquiry, detached from the patient and from the message it answered. Here the
 * two directions are one thread, in order, with a box to answer in.
 *
 * It reads and writes the same message documents the portal does — no second
 * store, no copy. A reply sent here is the message the patient sees.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ChartSection from '../ChartSection';
import { Send } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { messagesDB } from '@/lib/db';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { usePouchLiveReload } from '@/lib/hooks/usePouchLiveReload';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatDateTime } from '@/lib/format-utils';
import type { MessageDoc, PatientDoc } from '@/lib/db-types';
import { isFromPatient } from '@/modules/communication/services/patient-thread-service';

interface PatientMessagesSectionProps {
  patient: PatientDoc;
  patientName: string;
  /** Sender's facility name, shown to the patient on the message. */
  facilityName?: string;
}


export default function PatientMessagesSection({ patient, patientName, facilityName }: PatientMessagesSectionProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const scope = useDataScope();
  const patientId = patient._id;

  const [thread, setThread] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    // Still hydrating the session: keep "loading", not "no messages".
    if (!scope) { setThread([]); return; }
    try {
      const { getPatientThread } = await import('@/modules/communication/services/patient-thread-service');
      setThread(await getPatientThread(patientId, scope));
      setFailed(false);
    } catch (err) {
      console.error(err);
      // Not the same as an empty thread: the patient may well have written.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  const shouldReload = useCallback((change: { doc?: MessageDoc; deleted?: boolean }) => (
    !change.doc || change.doc.patientId === patientId || change.deleted === true
  ), [patientId]);
  usePouchLiveReload({ load, database: messagesDB, includeDocs: true, shouldReload });

  // Keep the newest message in view, the way a conversation reads.
  const visible = thread.filter(m => !m.deleted);
  const newestId = visible[visible.length - 1]?._id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [newestId]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending || !currentUser) return;
    setSending(true);
    try {
      const { createMessage } = await import('@/modules/communication/services/message-service');
      await createMessage({
        patientId,
        patientName,
        patientPhone: patient.phone || '',
        recipientType: 'patient',
        direction: 'staff_to_patient',
        fromDoctorId: currentUser._id,
        fromDoctorName: currentUser.name || currentUser.username || '',
        // A sender with no home facility files the message at the patient's,
        // so it does not become visible at every facility in the organisation.
        fromHospitalId: currentUser.hospitalId || patient.registrationHospital || undefined,
        fromHospitalName: facilityName || currentUser.hospitalName || '',
        subject: t('chartMessages.subject'),
        body,
        channel: 'app',
        sentAt: new Date().toISOString(),
        orgId: currentUser.orgId,
      });
      setDraft('');
      await load();
    } catch (err) {
      console.error(err);
      showToast(t('chartMessages.sendFailed'), 'error');
    } finally {
      setSending(false);
    }
  };

  // Whether the patient can actually read what is sent here. A message to a
  // patient with no portal account is not lost — it waits in their inbox — but
  // the sender should know nobody is reading it yet.
  const portalState = patient.portalDisabledAt ? 'disabled'
    : patient.portalLastLoginAt ? 'active'
    : patient.portalEnabledAt ? 'invited'
    : 'none';

  return (
    <ChartSection title={t('chartMessages.title')}>
      {portalState !== 'active' && (
        <p className="tamam-attestation tamam-thread-note">{t(`chartMessages.portal.${portalState}`)}</p>
      )}

      <div className="tamam-thread" role="log" aria-label={t('chartMessages.title')}>
        {visible.length === 0 && (
          <p className="tamam-thread-empty">
            {failed ? t('chartMessages.loadFailed') : loading ? t('common.loading') : t('chartMessages.empty')}
          </p>
        )}
        {visible.map((m) => {
          const mine = !isFromPatient(m);
          return (
            <div key={m._id} className={`tamam-thread-line${mine ? ' is-staff' : ''}`}>
              <div className="tamam-thread-bubble">
                <span className="tamam-thread-who">
                  {mine ? (m.fromDoctorName || t('chartMessages.careTeam')) : patientName}
                </span>
                <span className="tamam-thread-body">{m.body}</span>
                <span className="tamam-thread-when">
                  {formatDateTime(m.sentAt || m.createdAt)}
                  {m.channel === 'sms' || m.channel === 'both' ? ` · ${t('chartMessages.viaSms')}` : ''}
                  {m.patientEducation ? ` · ${t('chartMessages.education')}` : ''}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        className="tamam-thread-composer"
        onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
      >
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — what a chat box does.
            // Not while an input method is composing: there Enter picks a
            // candidate, it does not finish the message.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void handleSend(); }
          }}
          rows={2}
          placeholder={t('chartMessages.placeholder', { name: patientName })}
          aria-label={t('chartMessages.placeholder', { name: patientName })}
          disabled={sending}
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={sending || !draft.trim()}>
          <Send className="w-3.5 h-3.5" /> {t(sending ? 'chartMessages.sending' : 'chartMessages.send')}
        </button>
      </form>
    </ChartSection>
  );
}
