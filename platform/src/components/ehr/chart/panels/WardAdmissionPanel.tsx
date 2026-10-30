'use client';

/**
 * Ward admission, in the chart workspace. The form is the Wards page's own
 * (WardAdmitForm) with the chart's patient fixed.
 *
 * Admitting from the chart should close the OPD visit it grew out of, so the
 * patient's open encounter is resolved here and handed to the form. Not found
 * just means a plain admit with nothing to close. The form mounts once the
 * lookup settles, so the encounter is in its initial state rather than lost
 * to a later prop change.
 */

import { useEffect, useState } from 'react';
import WardAdmitForm from '@/components/wards/WardAdmitForm';
import type { PatientDoc } from '@/lib/db-types';
import type { ChartPanelUser } from './types';

export default function WardAdmissionPanel({ patient, currentUser, onClose }: {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  onClose: () => void;
}) {
  const hospitalId = currentUser?.hospitalId;
  // undefined = still looking; null = looked, none open.
  const [encounterId, setEncounterId] = useState<string | null | undefined>(hospitalId ? undefined : null);
  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    (async () => {
      try {
        const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
        const enc = await findOpenEncounterForPatient(patient._id, hospitalId);
        if (!cancelled) setEncounterId(enc?._id ?? null);
      } catch {
        if (!cancelled) setEncounterId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [patient._id, hospitalId]);

  if (encounterId === undefined) return null;
  return (
    <WardAdmitForm
      layout="workspace"
      lockedPatient={patient}
      encounterId={encounterId || undefined}
      onClose={onClose}
    />
  );
}
