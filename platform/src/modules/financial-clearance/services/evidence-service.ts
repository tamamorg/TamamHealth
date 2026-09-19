import { getDB } from '@/lib/db';
import type { EncounterDoc } from '@/lib/db-types';
import type { BillingDoc } from '@/lib/db-types-billing';
import { findByType } from '@/lib/services/db-query';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import { evaluateVisitFinancialEvidence } from '..';

/** Required tenant scope. Read failures propagate; an unreadable invoice is never zero. */
export async function getPatientVisitFinancialEvidence(patientId: string, scope: DataScope) {
  if (!scope.orgId || !scope.userId || !patientId) throw new Error('FINANCIAL_EVIDENCE_SCOPE_REQUIRED');
  const encounters = filterByScope(await findByType<EncounterDoc>(
    getDB('tamamhealth_encounters'), 'clinical_encounter', { patientId },
  ), scope).filter(encounter => encounter.orgId === scope.orgId);
  const bills = filterByScope(await findByType<BillingDoc>(
    getDB('tamamhealth_billing'), 'billing', { patientId },
  ), scope);
  // Explicit conflict reads: Mango results do not reliably include conflict metadata.
  const evidence = await Promise.all(bills.map(bill => getDB('tamamhealth_billing').get(bill._id, { conflicts: true }) as Promise<BillingDoc & { _conflicts?: string[] }>));
  return encounters.sort((a, b) => (b.startedAt || b.createdAt).localeCompare(a.startedAt || a.createdAt))
    .map(encounter => ({ ...evaluateVisitFinancialEvidence(encounter, evidence), startedAt: encounter.startedAt || encounter.createdAt }));
}
