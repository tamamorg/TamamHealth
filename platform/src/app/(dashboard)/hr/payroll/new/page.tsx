'use client';

/** Add payroll entry, full-page — the payroll popup's Expand destination. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AddPayrollEntryDialog from '@/components/create-dialogs/AddPayrollEntryDialog';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';

export default function NewPayrollEntryPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const returnTo = useReturnTo('/hr/payroll');

  /* The period the operator was looking at when they expanded, read after
     mount for the same reason `returnTo` is. Left empty the dialog defaults
     to the current month, which is right for a bookmark or a deep link. */
  const [period, setPeriod] = useState('');
  useEffect(() => {
    setPeriod(new URLSearchParams(window.location.search).get('period') ?? '');
  }, []);

  return (
    <CreateRecordPage
      title={t('hr.addPayrollEntryPeriod', { period: period || new Date().toISOString().slice(0, 7) })}
      note={t('createPage.payrollNote')}
      backLabel={t('createPage.backToPayroll')}
      returnTo={returnTo}
    >
      <AddPayrollEntryDialog
        presentation="page"
        period={period || undefined}
        onClose={() => router.push(returnTo)}
        // The register reads its period from its own control, not the URL,
        // so there is nothing to hand it — the entry is on the month it was
        // filed for when the operator selects it there.
        onCreated={() => router.push('/hr/payroll')}
      />
    </CreateRecordPage>
  );
}
