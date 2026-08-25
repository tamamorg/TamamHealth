'use client';

/**
 * Book appointment, full-page — the booking popup's Expand destination.
 *
 * `?date=` and `?patient=` carry whatever the popup had already been given by
 * the board it opened from, so expanding mid-booking does not throw away the
 * day the operator was looking at.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BookAppointmentModal from '@/components/appointments/BookAppointmentModal';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewAppointmentPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const returnTo = useReturnTo('/appointments');

  const [seed, setSeed] = useState<{ date?: string; patient?: string }>({});
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSeed({ date: params.get('date') ?? undefined, patient: params.get('patient') ?? undefined });
  }, []);

  return (
    <CreateRecordPage
      title={t('appointments.bookAppointment')}
      note={t('createPage.appointmentNote')}
      backLabel={t('createPage.backToAppointments')}
      returnTo={returnTo}
    >
      <BookAppointmentModal
        presentation="page"
        defaultDate={seed.date}
        defaultPatientId={seed.patient}
        onClose={() => router.push(returnTo)}
        onBooked={() => router.push('/appointments')}
      />
    </CreateRecordPage>
  );
}
