'use client';

/** Request leave, full-page — the leave popup's Expand destination. */

import { useRouter } from 'next/navigation';
import RequestLeaveDialog from '@/components/create-dialogs/RequestLeaveDialog';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewLeaveRequestPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const returnTo = useReturnTo('/hr/leave');

  return (
    <CreateRecordPage
      title={t('hr.requestLeave')}
      note={t('createPage.leaveNote')}
      backLabel={t('createPage.backToLeave')}
      returnTo={returnTo}
    >
      <RequestLeaveDialog
        presentation="page"
        onClose={() => router.push(returnTo)}
        onCreated={() => router.push('/hr/leave')}
      />
    </CreateRecordPage>
  );
}
