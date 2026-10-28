'use client';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { Dispatch, SetStateAction } from 'react';
import type { HospitalDoc } from '@/lib/db-types';
import type { AppUser } from '@/lib/context/types';
export function buildSendPatientMessage({ t, patient, currentUser, messageBody, setMessageError, messageChannel, messageTextConsent, setMessageSending, regHospital, messageSubject, messageIsEducation, setMessageSentWarning, setMessageSentNote, setMessageSent, setMessageBody, setMessageSubject, setMessageChannel, setMessageTextConsent, setMessageIsEducation }: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  patient: PatientDoc;
  currentUser: AppUser | null;
  messageBody: string;
  setMessageError: Dispatch<SetStateAction<string>>;
  messageChannel: "app" | "sms" | "both";
  messageTextConsent: boolean;
  setMessageSending: Dispatch<SetStateAction<boolean>>;
  regHospital: HospitalDoc | undefined;
  messageSubject: string;
  messageIsEducation: boolean;
  setMessageSentWarning: Dispatch<SetStateAction<boolean>>;
  setMessageSentNote: Dispatch<SetStateAction<string>>;
  setMessageSent: Dispatch<SetStateAction<boolean>>;
  setMessageBody: Dispatch<SetStateAction<string>>;
  setMessageSubject: Dispatch<SetStateAction<string>>;
  setMessageChannel: Dispatch<SetStateAction<"app" | "sms" | "both">>;
  setMessageTextConsent: Dispatch<SetStateAction<boolean>>;
  setMessageIsEducation: Dispatch<SetStateAction<boolean>>;
}) {
  const sendPatientMessage = async () => {
    if (!patient || !currentUser) return;
    const body = messageBody.trim();
    if (!body) {
      setMessageError(t('msg.enterAMessageBeforeSending'));
      return;
    }
    if ((messageChannel === 'sms' || messageChannel === 'both') && !patient.phone) {
      setMessageError(t('msg.noSmsSentThisPatient'));
      return;
    }
    if ((messageChannel === 'sms' || messageChannel === 'both') && !messageTextConsent) {
      setMessageError(t('msg.confirmThatThePatientAgreed'));
      return;
    }
    setMessageSending(true);
    setMessageError('');
    try {
      if (messageChannel === 'app') {
        const { createMessage } = await import('@/modules/communication/services/message-service');
        await createMessage({
          patientId: patient._id,
          patientName: patientFullName(patient),
          patientPhone: patient.phone || '',
          recipientType: 'patient',
          direction: 'staff_to_patient',
          fromDoctorId: currentUser._id,
          fromDoctorName: currentUser.name || currentUser.username || 'Care team',
          fromHospitalId: currentUser.hospitalId,
          fromHospitalName: regHospital?.name || patient.registrationHospital || '',
          subject: messageSubject.trim() || 'Patient message',
          body,
          channel: messageChannel,
          patientEducation: messageIsEducation || undefined,
          sentAt: new Date().toISOString(),
          orgId: currentUser.orgId,
        });
        setMessageSentWarning(false);
        setMessageSentNote('Message saved to the patient portal inbox.');
      } else {
        // SMS and App + SMS go through the text service: it writes the same
        // message, then actually hands the text to the gateway and records
        // what happened. Writing the document alone never sent anything.
        const { sendPatientText } = await import('@/modules/communication/services/patient-text-service');
        const { toSmsSafe } = await import('@/lib/sms/text');
        const result = await sendPatientText({
          patient: { _id: patient._id, name: patientFullName(patient), phone: patient.phone },
          text: toSmsSafe(body),
          subject: messageSubject.trim() || 'Patient message',
          channel: messageChannel,
          sender: {
            _id: currentUser._id,
            name: currentUser.name || currentUser.username || 'Care team',
            hospitalId: currentUser.hospitalId,
            hospitalName: regHospital?.name || patient.registrationHospital || '',
            orgId: currentUser.orgId,
          },
          patientEducation: messageIsEducation || undefined,
          // The server refuses a text without this, whichever screen sends it.
          consentConfirmed: messageTextConsent,
        });
        // The message is saved either way, so the form clears either way —
        // leaving it filled invited a second click and a second message. The
        // note says whether the text itself went.
        const undelivered = result.outcome === 'not_connected' || result.outcome === 'failed';
        setMessageSentWarning(undelivered);
        setMessageSentNote(result.outcome === 'failed'
          ? 'Message saved. The text was not sent; the SMS gateway refused it. Try again later.'
          : result.outcome === 'not_connected'
            ? (messageChannel === 'both'
              ? 'Message saved to the patient portal. No SMS gateway is connected, so no text was sent.'
              : 'Message saved to the record. No SMS gateway is connected, so no text was sent.')
            : result.outcome === 'queued'
              ? 'The text is saved and will send when the connection returns.'
              : 'Text sent.');
      }
      setMessageSent(true);
      setMessageBody('');
      setMessageSubject('Follow-up from your care team');
      setMessageChannel('app');
      setMessageTextConsent(false);
      setMessageIsEducation(false);
    } catch (err) {
      console.error(err);
      setMessageError(t('chartMessages.sendFailed'));
    } finally {
      setMessageSending(false);
    }
  };
  return sendPatientMessage;
}
