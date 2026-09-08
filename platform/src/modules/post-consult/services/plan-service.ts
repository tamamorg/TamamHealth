import { getDB, prescriptionsDB, labResultsDB, proceduresDB, medicalRecordsDB } from '@/lib/db';
import type { BaseDoc, EncounterDoc } from '@/lib/db-types';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import { findByType } from '@/lib/services/db-query';

/** A digest only, never a second copy of clinical free text.
 * Conservative: changes to results/fulfillment also require another review.
 * Unlinked patient orders are included because older order writers omit encounterId.
 */
export async function currentPlanRevision(encounter: EncounterDoc, scope: DataScope): Promise<string> {
  if (!scope?.userId || !filterByScope([encounter], scope).length) throw new Error('HANDOFF_FORBIDDEN');
  const sources = [
    [prescriptionsDB(), 'prescription'], [labResultsDB(), 'lab_result'],
    [proceduresDB(), 'procedure'], [medicalRecordsDB(), 'medical_record'],
    [getDB('tamamhealth_clinical_notes'), 'clinical_note'],
  ] as const;
  const sets = await Promise.all(sources.map(async ([db, type]) => {
    const docs = filterByScope(await findByType<BaseDoc & { patientId?: string; encounterId?: string; status?: string }>(db, type, { patientId: encounter.patientId }), scope);
    return docs.filter(d => (!d.encounterId || d.encounterId === encounter._id)
      && (type !== 'clinical_note' || d.status === 'signed' || d.status === 'amended'))
      .map(d => {
        // Replication bookkeeping must not reopen every reviewed visit.
        const clinical = Object.fromEntries(Object.entries(d).filter(([key]) => !['_rev', '_conflicts', 'offlineSync', 'updatedAt'].includes(key)));
        return canonical(clinical);
      });
  }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sets.flat().sort())));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
