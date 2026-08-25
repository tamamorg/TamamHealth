'use client';

/**
 * Transfer patient, full-page — the transfer popup's Expand destination.
 *
 * `?patient=` names the chart being transferred; the popup is always opened
 * from one, so the page refuses rather than guesses when it is missing.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import TransferPatientModal from '@/components/patients/TransferPatientModal';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';
import { getPatientById } from '@/lib/services/patient-service';
import type { PatientDoc } from '@/lib/db-types';

export default function NewTransferPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const scope = useDataScope();
  const returnTo = useReturnTo('/transfers');

  /* Three states, not two: the URL has not been read yet, it named nobody, or
     it named someone. Collapsing the first two leaves the page spinning
     forever on a bare `/transfers/new` — which is the one case the empty
     state below exists for. */
  const [patientId, setPatientId] = useState<string | null | undefined>(undefined);
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPatientId(new URLSearchParams(window.location.search).get('patient'));
  }, []);

  useEffect(() => {
    if (patientId === undefined) return;
    if (!patientId) { setLoading(false); return; }
    if (!scope) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await getPatientById(patientId, scope);
        if (!cancelled) setPatient(found);
      } catch (err) {
        console.error('[transfers] could not load the patient:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId, scope]);

  if (loading) return null;

  return (
    <CreateRecordPage
      title={t('createPage.transferTitle')}
      note={t('createPage.transferNote')}
      backLabel={t('createPage.backToTransfers')}
      returnTo={returnTo}
    >
      {patient
        ? (
          <TransferPatientModal
            presentation="page"
            patient={patient}
            onClose={() => router.push(returnTo)}
            onTransferred={() => router.push('/transfers')}
          />
        )
        : <p className="sadb-empty">{t('createPage.transferNoPatient')}</p>}
    </CreateRecordPage>
  );
}
