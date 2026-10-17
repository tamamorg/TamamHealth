import { type TriageDoc } from '@/lib/db-types';

/**
 * Whether an existing active triage record is safe to silently resume onto —
 * i.e. it is still an unassessed placeholder, never a completed assessment
 * from someone else. `pending` is the clerical walk-in placeholder
 * `createTriage`'s `resumePendingId` path exists for (see triage-service.ts);
 * `assessmentSource === 'clerical_checkin'` identifies the same placeholder
 * the other way, as defense in depth if status and source ever disagree.
 *
 * A `seen` record is a completed clinician assessment — resuming onto it
 * would run it through `updateTriage`, which has no guard against a
 * seen → seen write, so Station B's payload would silently overwrite Station
 * A's finished ETAT (and, on a multi-org replica, potentially a foreign
 * tenant's record). Auto-resume must refuse anything that isn't the
 * placeholder and let the caller fall back to its "refresh, don't overwrite"
 * path instead.
 */
export function mayAutoResume(
  existing: Pick<TriageDoc, 'status' | 'assessmentSource'> | null | undefined,
): boolean {
  if (!existing) return false;
  return existing.status === 'pending' || existing.assessmentSource === 'clerical_checkin';
}

// Mode-of-arrival → Source column label, using the same terms as the ETAT
// form's own <select> options.
export function modeOfArrivalLabel(mode: string | undefined, t: (key: string) => string): string {
  switch (mode) {
    case 'walk-in': return t('nurse.modeWalkIn');
    case 'ambulance': return t('nurse.modeAmbulance');
    case 'referral': return t('nurse.modeReferral');
    case 'police': return t('nurse.modePolice');
    case 'other': return t('nurse.modeOther');
    default: return '—';
  }
}
