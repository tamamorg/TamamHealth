'use client';

import { useAuth } from '../context';
import { useHospitals } from './useHospitals';

/**
 * The signed-in user's facility name, resolved the way the top rail does it
 * (`resolveRailFacilityName`).
 *
 * `currentUser.hospitalName` alone is not enough: a session hydrated before
 * the facility record reached this device carries only the id, so screens
 * that read the name fell back to "This facility" — and the prescription
 * form wrote that placeholder into the pharmacy and service location it
 * stored. The live hospitals store fills the gap as soon as it loads.
 */
export function useFacilityName(): string | undefined {
  const { currentUser } = useAuth();
  const { hospitals } = useHospitals();
  const liveName = currentUser?.hospitalId
    ? hospitals.find(h => h._id === currentUser.hospitalId)?.name
    : undefined;
  return liveName || currentUser?.hospital?.name || currentUser?.hospitalName || undefined;
}
