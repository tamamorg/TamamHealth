'use client';

/**
 * Prescribe medications, full-page — the prescribe popup's Expand destination.
 *
 * Laid out `full`: the form is already two columns, the right one carrying the
 * drug monograph, and a page rail beside that leaves neither enough room.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import PrescribeModal from '@/components/clinical-notes/prescribe/PrescribeModal';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';
import { patientFullName } from '@/lib/patient-utils';
import { getPatientById } from '@/lib/services/patient-service';
import type { PatientDoc } from '@/lib/db-types';

export default function NewPrescriptionPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const patientId = params?.id ?? '';
  const chart = `/patients/${encodeURIComponent(patientId)}?tab=medications`;
  const returnTo = useReturnTo(chart);

  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [encounterId, setEncounterId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEncounterId(new URLSearchParams(window.location.search).get('encounter') ?? undefined);
  }, []);

  useEffect(() => {
    if (!scope || !patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await getPatientById(patientId, scope);
        if (!cancelled) setPatient(found);
      } catch (err) {
        console.error('[prescribe] could not load the patient:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId, scope]);

  // A prescription is written for a named patient by a named prescriber.
  // Neither is guessable, so the form waits rather than opening half-blank.
  if (loading || !patient || !currentUser) return null;

  return (
    <CreateRecordPage
      layout="full"
      title={t('createPage.prescribeTitle')}
      note={t('createPage.prescribeNote')}
      backLabel={t('createPage.backToChart')}
      returnTo={returnTo}
    >
      <PrescribeModal
        presentation="page"
        patientId={patient._id}
        patientName={patientFullName(patient)}
        currentUser={currentUser}
        encounterId={encounterId}
        onClose={() => router.push(returnTo)}
        onPrescribed={() => router.push(chart)}
      />
    </CreateRecordPage>
  );
}
