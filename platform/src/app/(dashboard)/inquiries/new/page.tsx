'use client';

/**
 * Log inquiry, full-page — where the inquiry popup's Expand control lands.
 *
 * It hosts the same `AddInquiryDialog` in `presentation="page"`, so the fields
 * and the write are the popup's own; only the frame differs.
 */

import { useRouter } from 'next/navigation';
import AddInquiryDialog from '@/components/create-dialogs/AddInquiryDialog';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewInquiryPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showToast } = useToast();
  const returnTo = useReturnTo('/inquiries');

  return (
    <CreateRecordPage
      title={t('createPage.inquiryTitle')}
      note={t('createPage.inquiryNote')}
      backLabel={t('createPage.backToInquiries')}
      returnTo={returnTo}
    >
      <AddInquiryDialog
        presentation="page"
        onClose={() => router.push(returnTo)}
        onCreated={() => {
          showToast(t('createPage.inquiryLogged'), 'success');
          // The record's home, not `returnTo`: a logged inquiry is a row on
          // the triage list, and that is where it can be acted on.
          router.push('/inquiries');
        }}
      />
    </CreateRecordPage>
  );
}
