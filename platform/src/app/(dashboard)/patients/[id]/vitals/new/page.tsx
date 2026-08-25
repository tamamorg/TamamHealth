'use client';

/**
 * Record vitals, full-page — the vitals popup's Expand destination.
 *
 * The popup is handed its patient by the chart it opens over. Standing alone
 * this page has only an id, so it loads the chart's identity itself and hands
 * the same props down; the form and its write are unchanged.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import NurseVitalsModal from '@/components/nurse/NurseVitalsModal';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';
import { patientFullName } from '@/lib/patient-utils';
import { getPatientById } from '@/lib/services/patient-service';
import type { PatientDoc } from '@/lib/db-types';

export default function NewVitalsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const patientId = params?.id ?? '';
  const chart = `/patients/${encodeURIComponent(patientId)}?tab=vitals`;
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
        console.error('[vitals] could not load the patient:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId, scope]);

  // Vitals are filed against a named patient at a named facility. Rendering
  // the form before either is known would let a reading be saved with neither.
  if (loading || !patient || !currentUser) return null;

  return (
    <CreateRecordPage
      title={t('createPage.vitalsTitle')}
      note={t('createPage.vitalsNote')}
      backLabel={t('createPage.backToChart')}
      returnTo={returnTo}
    >
      <NurseVitalsModal
        presentation="page"
        patientId={patient._id}
        patientName={patientFullName(patient)}
        hospitalNumber={patient.hospitalNumber}
        hospitalId={currentUser.hospitalId || patient.registrationHospital || ''}
        hospitalName={currentUser.hospital?.name || currentUser.hospitalName || patient.registrationHospital || undefined}
        orgId={currentUser.orgId}
        encounterId={encounterId}
        currentUser={currentUser}
        onClose={() => router.push(returnTo)}
        onSaved={() => router.push(chart)}
      />
    </CreateRecordPage>
  );
}
