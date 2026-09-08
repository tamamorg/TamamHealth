import { encountersDB } from '@/lib/db';
import type { EncounterDoc } from '@/lib/db-types';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import { findByType } from '@/lib/services/db-query';
import { isTerminal } from '@/lib/clinical-flow/encounter-journey';

/** Link a current visit note only when the scoped visit is unambiguous. */
export async function resolveNoteEncounter(patientId: string, scope: DataScope, appointmentId?: string): Promise<string | undefined> {
  if (!scope?.userId || !scope.hospitalId) throw new Error('HANDOFF_FORBIDDEN');
  const rows = filterByScope(await findByType<EncounterDoc>(encountersDB(), 'clinical_encounter', { patientId }), scope)
    .filter(row => row.hospitalId === scope.hospitalId && !isTerminal(row.status) && (!appointmentId || row.appointmentId === appointmentId));
  if (rows.length > 1) throw new Error('AMBIGUOUS_NOTE_ENCOUNTER');
  return rows[0]?._id;
}
