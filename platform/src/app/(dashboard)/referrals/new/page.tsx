'use client';

/** Create referral, full-page — the referral popup's Expand destination. */

import { useRouter } from 'next/navigation';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import ReferralFormModal from '@/components/referrals/ReferralFormModal';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewReferralPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const returnTo = useReturnTo('/referrals');

  return (
    <CreateRecordPage
      title={t('referrals.createNew')}
      note={t('createPage.referralNote')}
      backLabel={t('createPage.backToReferrals')}
      returnTo={returnTo}
    >
      <ReferralFormModal
        presentation="page"
        onClose={() => router.push(returnTo)}
        onSent={() => router.push('/referrals')}
      />
    </CreateRecordPage>
  );
}
