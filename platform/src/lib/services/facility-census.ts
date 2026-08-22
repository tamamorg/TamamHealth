/**
 * Real per-facility census — the honest replacement for
 * `HospitalDoc.patientCount` / `HospitalDoc.todayVisits`.
 *
 * Those two fields are written exactly once, as `0`, when a facility is
 * created (`hospital-service.ts`), and by nothing else the app ever calls —
 * so every screen that displayed them showed a number that measured how the
 * record was created, not how the facility is doing. In demo they carried
 * whatever literals the seed put there; in production they read 0 forever.
 * The 2026-08 hardcoded-data sweep found them rendered as "Patients" and
 * "Today's visits" on six different surfaces.
 *
 * This module computes the same two figures from the records that actually
 * exist: patients grouped by the facility that holds them, and encounters
 * whose clinical day (Africa/Juba — see time-juba.ts) is today. Callers pass
 * their scope exactly as they would to any other service; tenancy stays
 * `filterByScope`'s job inside the services this one composes.
 */

import { jubaDate } from '@/lib/time-juba';
import type { DataScope } from '@/lib/services/data-scope';

export interface FacilityCensusEntry {
  patients: number;
  todayVisits: number;
}

/** Per-facility counts, keyed by hospitalId. Facilities with no records are
 *  simply absent — read with `censusFor` so they render 0, not undefined. */
export async function getFacilityCensus(scope?: DataScope): Promise<Map<string, FacilityCensusEntry>> {
  const [{ getAllPatients }, { getAllEncounters }] = await Promise.all([
    import('@/lib/services/patient-service'),
    import('@/lib/services/encounter-service'),
  ]);
  const [patients, encounters] = await Promise.all([
    getAllPatients(scope),
    getAllEncounters(scope),
  ]);

  const today = jubaDate();
  const map = new Map<string, FacilityCensusEntry>();
  const entry = (id: string): FacilityCensusEntry => {
    let e = map.get(id);
    if (!e) { e = { patients: 0, todayVisits: 0 }; map.set(id, e); }
    return e;
  };

  for (const p of patients) {
    // The facility that registered the patient is their census home — the
    // same field the patient registry itself displays.
    if (p.registrationHospital) entry(p.registrationHospital).patients++;
  }
  for (const e of encounters) {
    const at = e.startedAt || e.createdAt || '';
    // Same Juba-day bucketing every clinical "today" uses — a raw UTC slice
    // moves late-evening visits onto tomorrow.
    if (e.hospitalId && at && jubaDate(at) === today) entry(e.hospitalId).todayVisits++;
  }
  return map;
}

/** Zero-filled read so a facility with no records renders 0 / 0. */
export function censusFor(census: Map<string, FacilityCensusEntry> | null | undefined, hospitalId: string): FacilityCensusEntry {
  return census?.get(hospitalId) ?? { patients: 0, todayVisits: 0 };
}
