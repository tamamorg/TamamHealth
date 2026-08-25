'use client';

/**
 * Add allergy, full-page — the allergy popup's Expand destination.
 *
 * The write lives here, not in the form: `AddAllergyModal` deliberately takes
 * no patient, so each host supplies the same `addAllergy` call with its own
 * author. This page is one more host of that contract.
 */

import { useParams, useRouter } from 'next/navigation';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import AddAllergyModal from '@/components/patients/AddAllergyModal';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewAllergyPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const patientId = params?.id ?? '';
  const chart = `/patients/${encodeURIComponent(patientId)}?tab=allergies`;
  const returnTo = useReturnTo(chart);

  return (
    <CreateRecordPage
      title={t('createPage.allergyTitle')}
      note={t('createPage.allergyNote')}
      backLabel={t('createPage.backToChart')}
      returnTo={returnTo}
    >
      <AddAllergyModal
        presentation="page"
        patientId={patientId}
        onClose={() => router.push(returnTo)}
        onSave={async input => {
          const svc = await import('@/lib/services/allergy-service');
          await svc.addAllergy(patientId, {
            ...input,
            recordedBy: currentUser?._id,
            recordedByName: currentUser?.name || currentUser?.username,
          });
          router.push(chart);
        }}
      />
    </CreateRecordPage>
  );
}
