'use client';

/**
 * Create lab order, full-page — the lab-order popup's Expand destination.
 *
 * Laid out `full` rather than with a rail: phase two is the six-step
 * requisition wizard, which carries a step rail of its own.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import LabOrderModal from '@/components/lab/order/LabOrderModal';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewLabOrderPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const returnTo = useReturnTo('/lab');

  const [patientId, setPatientId] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setPatientId(new URLSearchParams(window.location.search).get('patient') ?? undefined);
    setReady(true);
  }, []);

  // The draft controller reads its preset patient once, on mount, so the flow
  // must not mount before the URL has been read — or a chart's order opens
  // asking which patient it is for.
  if (!ready) return null;

  return (
    <CreateRecordPage
      layout="full"
      title={t('labOrder.createOrder')}
      note={t('labOrder.createOrderSubtitle')}
      backLabel={t('createPage.backToLab')}
      returnTo={returnTo}
    >
      <LabOrderModal
        presentation="page"
        presetPatientId={patientId}
        onClose={() => router.push(returnTo)}
        onPlaced={() => router.push('/lab')}
      />
    </CreateRecordPage>
  );
}
