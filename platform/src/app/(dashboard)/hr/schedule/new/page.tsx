'use client';

/** Schedule shift, full-page — the shift popup's Expand destination. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CreateShiftDialog from '@/components/create-dialogs/CreateShiftDialog';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewShiftPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const returnTo = useReturnTo('/hr/schedule');

  /* The day the operator was looking at when they expanded, read after mount
     for the same reason `returnTo` is. Empty falls back to today. */
  const [date, setDate] = useState('');
  useEffect(() => {
    setDate(new URLSearchParams(window.location.search).get('date') ?? '');
  }, []);

  return (
    <CreateRecordPage
      title={t('hr.scheduleShift')}
      note={t('createPage.shiftNote')}
      backLabel={t('createPage.backToSchedule')}
      returnTo={returnTo}
    >
      <CreateShiftDialog
        presentation="page"
        defaultDate={date || undefined}
        onClose={() => router.push(returnTo)}
        // Land on the day the shift was actually booked for, the same
        // correction the schedule page makes when the popup reports back.
        onCreated={shiftDate => router.push(`/hr/schedule?date=${encodeURIComponent(shiftDate)}`)}
      />
    </CreateRecordPage>
  );
}
