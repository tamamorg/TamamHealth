'use client';

/**
 * The presenting complaint of the patient's open visit, for an order that was
 * not opened from a note (the lab queue's "New order"). Read from the
 * consultation draft on the encounter, falling back to what triage recorded.
 *
 * Best effort by design: the complaint only feeds reason suggestions, so a
 * failed or slow read costs a suggestion, never the order.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';

export function useVisitComplaint(patient: PatientDoc | null, skip = false): string {
  const { currentUser } = useAuth();
  const [found, setFound] = useState<{ patientId: string; text: string } | null>(null);
  const patientId = patient?._id;
  const hospitalId = currentUser?.hospitalId || patient?.registrationHospital;

  useEffect(() => {
    if (skip || !patientId || !hospitalId) return;
    let cancelled = false;
    (async () => {
      try {
        const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
        const open = await findOpenEncounterForPatient(patientId, hospitalId);
        if (!open) return;
        const drafted = open.snapshot?.chiefComplaint;
        let text = typeof drafted === 'string' ? drafted : '';
        if (!text.trim()) {
          const { getTriageByEncounter } = await import('@/lib/services/triage-service');
          text = (await getTriageByEncounter(open._id))?.chiefComplaint || '';
        }
        if (!cancelled) setFound({ patientId, text });
      } catch {
        // Suggestions are a convenience; the picker works without them.
      }
    })();
    return () => { cancelled = true; };
  }, [skip, patientId, hospitalId]);

  // Keyed by patient so switching charts never shows the last one's complaint.
  return found && found.patientId === patientId ? found.text : '';
}
