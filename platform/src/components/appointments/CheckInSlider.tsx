'use client';

/**
 * Check a booked patient in from a dashboard's status pill — as a slider (on a
 * dashboard it docks over the right panel). It asks what Start a visit asks of
 * a booked arrival (useCheckInDraft), then checks the patient in: the
 * appointment goes to Checked in and the visit opens with the visit setting,
 * attendance, payer and punctuality on it.
 */

import { useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { FormError } from '@/components/overlay/FormNotices';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatClockTime } from '@/lib/format-utils';
import { describeError } from '@/lib/user-facing-error';
import { jubaDate } from '@/lib/time-juba';
import type { AppointmentDoc } from '@/lib/db-types';
import { useCheckInDraft } from './useCheckInDraft';
import '@/components/ehr/chart/panels/start-visit-panel.css';

export default function CheckInSlider({ appointment, hospitalNumber, onClose, onCheckedIn }: {
  appointment: AppointmentDoc;
  hospitalNumber?: string;
  onClose: () => void;
  onCheckedIn?: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  // A booking is checked in on its own day — checking in a later one would
  // stamp the visit on the wrong date (Start a visit refuses it the same way).
  const onTheDay = appointment.appointmentDate === jubaDate();
  const draft = useCheckInDraft(appointment, onTheDay, 'stack');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkIn = async () => {
    if (!onTheDay) return;
    if (!draft.complete) { setError(t('startVisit.billingIncomplete')); return; }
    setSaving(true);
    setError(null);
    try {
      const { checkInAppointment } = await import('@/lib/services/check-in-service');
      await checkInAppointment({
        appointmentId: appointment._id,
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        hospitalNumber,
        facilityId: appointment.facilityId || currentUser?.hospitalId,
        facilityName: appointment.facilityName || currentUser?.hospitalName,
        orgId: appointment.orgId || currentUser?.orgId,
        attendanceType: draft.attendance,
        visit: draft.visit,
        actorId: currentUser?._id,
        actorName: currentUser?.name || currentUser?.username,
        actorRole: currentUser?.role,
      });
      showToast(t('startVisit.checkedIn', { name: appointment.patientName }), 'success');
      onCheckedIn?.();
      onClose();
    } catch (err) {
      setError(describeError(err, t('startVisit.notStarted')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSlider
      title={t('frontDesk.checkInTitle')}
      subtitle={`${appointment.patientName}${appointment.appointmentTime ? ` · ${formatClockTime(appointment.appointmentTime)}` : ''}`}
      width={480}
      busy={saving}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>{t('action.cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={() => void checkIn()} disabled={saving || !onTheDay}>{t('frontDesk.checkInTab')}</button>
      </>}
    >
      <div className="sv-root sv-root--slider">
        {error && <FormError message={error} />}
        {!onTheDay && <p className="status-slider-body">{t('statusSlider.notToday', { date: appointment.appointmentDate })}</p>}
        {onTheDay && (<>
        <section className="sv-section">
          <h3 className="sv-section-title">{t('startVisit.detailsTitle')}</h3>
          {draft.detailsFields}
        </section>
        <section className="sv-section">
          <h3 className="sv-section-title">{t('startVisit.billingTitle')}</h3>
          {draft.billingFields}
        </section>
        </>)}
      </div>
    </FormSlider>
  );
}
