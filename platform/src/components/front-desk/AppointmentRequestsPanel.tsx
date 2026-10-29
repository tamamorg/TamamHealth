'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatClockTime } from '@/lib/format-utils';
import type { AppointmentDoc, AppointmentStatus } from '@/lib/db-types';
import type { AppointmentStatusUpdateExtra } from '@/lib/services/appointment-service';
import {
  contactPreferenceOf, pendingRequests, requestPhone, requestSourceKey, smsHref, telHref,
} from '@/lib/appointment-requests';
import { describeError } from '@/lib/user-facing-error';

interface Props {
  appointments: AppointmentDoc[];
  today: string;
  facilityId?: string;
  onClose: () => void;
  onEdit: (appt: AppointmentDoc) => void;
  updateStatus: (id: string, status: AppointmentStatus, extra?: AppointmentStatusUpdateExtra) => Promise<unknown>;
}

const SOURCE_KEYS = {
  portal: 'frontDesk.requestSourcePortal',
  public_widget: 'frontDesk.requestSourceOnline',
  directory: 'frontDesk.requestSourceDirectory',
  staff: 'frontDesk.requestSourceStaff',
} as const;

const PREF_KEYS = {
  call: 'frontDesk.requestPrefCall',
  sms: 'frontDesk.requestPrefSms',
  either: 'frontDesk.requestPrefEither',
} as const;

const linkStyle = {
  padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border-medium)',
  background: 'var(--bg-card)', color: 'var(--accent-text)', fontSize: 12, fontWeight: 600,
  textDecoration: 'none', whiteSpace: 'nowrap' as const,
};
const metaStyle = { margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' };

export default function AppointmentRequestsPanel({
  appointments, today, facilityId, onClose, onEdit, updateStatus,
}: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const requests = useMemo(() => pendingRequests(appointments, today, facilityId), [appointments, today, facilityId]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const setError = (id: string, msg: string | null) =>
    setErrors(prev => {
      const next = { ...prev };
      if (msg) next[id] = msg; else delete next[id];
      return next;
    });

  const confirm = async (appt: AppointmentDoc) => {
    setBusyId(appt._id);
    setError(appt._id, null);
    try {
      await updateStatus(appt._id, 'confirmed');
      showToast(t('frontDesk.requestConfirmed', { name: appt.patientName }), 'success');
    } catch (err) {
      // BookingConflictError carries a message written for the clerk.
      setError(appt._id, describeError(err, t('frontDesk.requestConfirmFailed')));
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (appt: AppointmentDoc) => {
    const why = reason.trim();
    if (!why) { setError(appt._id, t('frontDesk.requestDeclineReasonRequired')); return; }
    setBusyId(appt._id);
    setError(appt._id, null);
    try {
      await updateStatus(appt._id, 'cancelled', { cancelledReason: why });
      showToast(t('frontDesk.requestDeclined', { name: appt.patientName }), 'success');
      setDeclining(null);
      setReason('');
    } catch (err) {
      setError(appt._id, describeError(err, t('frontDesk.requestDeclineFailed')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal onClose={onClose} size="lg" labelledBy="fd-requests-title" describedBy="fd-requests-body">
      <DialogFrame>
        <DialogHeader
          titleId="fd-requests-title"
          title={t('frontDesk.requestsTitle')}
          descriptionId="fd-requests-body"
          description={t('frontDesk.requestsBody')}
          closeLabel={t('action.close')}
          onClose={onClose}
        />
        <DialogBody className="flex flex-col gap-3">
        {requests.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('frontDesk.requestsEmpty')}</p>
        )}
        {requests.map(appt => {
          const phone = requestPhone(appt);
          const tel = telHref(phone);
          const sms = smsHref(phone);
          const pref = contactPreferenceOf(appt);
          const src = requestSourceKey(appt);
          const name = appt.patientName
            || [appt.requester?.firstName, appt.requester?.lastName].filter(Boolean).join(' ')
            || appt.patientId;
          const busy = busyId === appt._id;
          return (
            <div key={appt._id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderTop: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</p>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(SOURCE_KEYS[src])}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {appt.appointmentDate} · {formatClockTime(appt.appointmentTime) || '--'}
                </span>
              </div>
              <p style={metaStyle}>
                {[appt.providerName, appt.reason, appt.department].filter(Boolean).join(' · ') || t('frontDesk.requestNoDetails')}
              </p>
              {appt.patientNotes && <p style={{ ...metaStyle, color: 'var(--text-secondary)' }}>{appt.patientNotes}</p>}
              {(appt.bookingReference || appt.requester?.email || appt.requester?.dateOfBirth || appt.insuranceSubmitted) && (
                <p style={metaStyle}>
                  {[
                    appt.bookingReference && `${t('frontDesk.requestRef')} ${appt.bookingReference}`,
                    appt.requester?.email,
                    appt.requester?.dateOfBirth && `${t('frontDesk.requestDob')} ${appt.requester.dateOfBirth}`,
                    appt.insuranceSubmitted && `${appt.insuranceSubmitted.provider} ${appt.insuranceSubmitted.memberId}`,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {phone ? (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{phone}</span>
                    {tel && <a href={tel} style={linkStyle}>{t('frontDesk.requestCall')}</a>}
                    {sms && <a href={sms} style={linkStyle}>{t('frontDesk.requestText')}</a>}
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('frontDesk.requestNoPhone')}</span>
                )}
                {pref && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(PREF_KEYS[pref])}</span>}
              </div>
              {errors[appt._id] && (
                <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-danger-text)' }}>{errors[appt._id]}</p>
              )}
              {declining === appt._id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    aria-label={t('frontDesk.requestDeclineReason')}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={2}
                    placeholder={t('frontDesk.requestDeclineReason')}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setDeclining(null); setReason(''); setError(appt._id, null); }}>
                      {t('appointments.goBack')}
                    </button>
                    <button type="button" className="btn btn-danger-solid btn-sm" disabled={busy} onClick={() => void decline(appt)}>
                      {t('frontDesk.requestDecline')}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setDeclining(appt._id); setReason(''); setError(appt._id, null); }}>
                    {t('frontDesk.requestDecline')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onEdit(appt)}>
                    {t('frontDesk.requestEdit')}
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void confirm(appt)}>
                    {t('frontDesk.requestConfirm')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        </DialogBody>
        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('action.close')}</button>
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
