'use client';

/**
 * Triage, one patient at a time.
 *
 * The nursing station's triage board is a facility-wide surface: a search box
 * to find anyone, one blank ETAT form, and everybody's recent triages beside
 * it. That is the right shape for "who is next", and the wrong shape once a
 * nurse has a patient in front of them — the first thing they have to do is
 * find that person again in a search box, and everything else on screen is
 * about other people.
 *
 * This page is the second shape. The patient is fixed by the URL, so the form
 * cannot drift onto someone else mid-assessment, the list beside it is that
 * patient's own triage history, and the page is addressable — a queue row, a
 * notification, or a handover message can send a nurse straight to the person
 * they need to assess.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { getRoleConfig } from '@/lib/permissions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ArrowLeft } from '@/components/icons/lucide';
import TriageWorkflow from '@/components/nurse/TriageWorkflow';
import type { PatientDoc } from '@/lib/db-types';

export default function PatientTriagePage() {

  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const patientId = String(params?.patientId || '');
  const { patients, loading } = usePatients();

  // Where "back" goes depends on who is here: the nurse's triage station is
  // not in a doctor's route table, so a doctor following the chart's
  // "Triage/ETAT" form landed on RoleGuard's Access Restricted screen.
  const nurseStation = '/dashboard/nurse';
  const backTarget = currentUser && getRoleConfig(currentUser.role)?.allowedRoutes?.some(
    route => nurseStation === route || nurseStation.startsWith(`${route}/`),
  )
    ? '/dashboard/nurse?station=ward'
      : currentUser
        ? getRoleConfig(currentUser.role)?.defaultDashboard || '/dashboard'
        : '/dashboard';
  const stationDateLabel = useMemo(() => (
    new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit' }).format(new Date())
  ), []);

  const scopedPatient = useMemo(
    () => patients.find(p => p._id === patientId) || null,
    [patients, patientId],
  );

  // The nurse queue can contain a patient registered at another facility in
  // the same organisation (for example, a referral). The scoped list will not
  // include that record, so resolve the exact id directly as a safe fallback.
  const [fallbackPatient, setFallbackPatient] = useState<PatientDoc | null>(null);
  const [fallbackChecked, setFallbackChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFallbackPatient(null);
    setFallbackChecked(false);
    if (!patientId || loading || scopedPatient) {
      setFallbackChecked(true);
      return () => { cancelled = true; };
    }
    (async () => {
      const { getPatientById } = await import('@/lib/services/patient-service');
      const doc = await getPatientById(patientId);
      if (cancelled) return;
      const sameOrg = !doc?.orgId || !currentUser?.orgId || doc.orgId === currentUser.orgId;
      const isNational = currentUser?.role === 'super_admin' || currentUser?.role === 'government';
      setFallbackPatient(doc && (sameOrg || isNational) ? doc : null);
      setFallbackChecked(true);
    })();
    return () => { cancelled = true; };
  }, [patientId, loading, scopedPatient, currentUser?.orgId, currentUser?.role]);

  const patient = scopedPatient ?? fallbackPatient;

  if (loading || !fallbackChecked || !patient) {
    return (
      <main className="page-container flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {loading || !fallbackChecked ? t('status.loading') : t('patient.notFound')}
        </p>
      </main>
    );
  }

  return (
    <main className="page-container page-enter patient-registration-page triage-patient-page">
      {/* Not `.ehr-chart-back` — globals hides that class outright; it belongs
          to the chart, which has its own way back. */}
      <button
        type="button"
        onClick={() => router.push(backTarget)}
        className="patient-registration-back no-print"
      >
        <ArrowLeft className="w-4 h-4" style={{ stroke: 'currentColor' }} />
        {backTarget.startsWith('/dashboard/nurse') ? stationDateLabel : 'Back to dashboard'}
      </button>

      <div className="triage-patient-workspace">
        <TriageWorkflow lockedPatientId={patient._id} lockedPatient={patient} />
      </div>
    </main>
  );
}
