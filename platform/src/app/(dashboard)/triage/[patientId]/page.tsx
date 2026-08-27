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
import { returnToFromSearch } from '@/lib/navigation/return-to';

export default function PatientTriagePage() {

  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const patientId = String(params?.patientId || '');
  const { patients, loading } = usePatients();

  // Nurses and doctors both go back to their own role's default dashboard —
  // the standalone nurse station was merged into the shared clinical
  // workspace, so there's no separate station route left to special-case
  // (both currently resolve to '/dashboard', but this stays role-driven so
  // it keeps working if a role's default ever diverges again).
  const backTarget = currentUser
    ? getRoleConfig(currentUser.role)?.defaultDashboard || '/dashboard'
    : '/dashboard';

  const scopedPatient = useMemo(
    () => patients.find(p => p._id === patientId) || null,
    [patients, patientId],
  );

  // The nurse queue can contain a patient registered at another facility in
  // the same organisation (for example, a referral). The scoped list will not
  // include that record, so resolve the exact id directly as a safe fallback,
  // gated through the canonical `getPatientById(id, scope)` / `filterByScope`
  // rather than a bespoke check.
  //
  // The scope passed is deliberately org + role only (no `hospitalId`) — see
  // the identical fallback in PatientDetailPage.tsx for why: it keeps this
  // limited to the org boundary (same as before) while now correctly
  // rejecting a doc with no `orgId` at all, and folding the super_admin /
  // government bypass into the one shared `filterByScope` check instead of a
  // second "isNational" condition maintained here separately.
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
    const role = currentUser?.role;
    if (!role) {
      setFallbackChecked(true);
      return () => { cancelled = true; };
    }
    const orgId = currentUser?.orgId;
    (async () => {
      const { getPatientById } = await import('@/lib/services/patient-service');
      const doc = await getPatientById(patientId, { orgId, role });
      if (cancelled) return;
      setFallbackPatient(doc);
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
        onClick={() => router.push(returnToFromSearch(window.location.search, backTarget))}
        className="patient-registration-back no-print"
      >
        <ArrowLeft className="w-4 h-4" style={{ stroke: 'currentColor' }} />
        Back
      </button>

      <div className="triage-patient-workspace">
        <TriageWorkflow
          lockedPatientId={patient._id}
          lockedPatient={patient}
          onSaved={() => router.replace(returnToFromSearch(window.location.search, backTarget))}
        />
      </div>
    </main>
  );
}
