/**
 * What THIS visit still owes from the patient, for the checkout gate.
 *
 * The gate used to read the whole-patient ledger, which is wrong in two ways:
 * an old unpaid visit blocked every later checkout, and an insured patient was
 * blocked by the insurer's share, which sits on the ledger until the claim is
 * settled. The figure here is the visit's own open bills, less what the insurer
 * is expected to pay on them. Nothing is owed on a non-paying visit, or on a
 * bill that was created waived (an exempt visit) or has been waived, paid,
 * cancelled or reversed.
 */
import type { BillingDoc } from '../db-types-billing';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';

const OPEN_STATUSES: readonly string[] = ['pending', 'partial', 'insurance_pending', 'insurance_approved', 'insurance_rejected'];
const cents = (n: number) => Math.round(n * 100);

/** The patient's own part of one bill: its balance less the insurer's expected, unpaid share. */
export function patientShareDue(bill: Pick<BillingDoc, 'status' | 'balanceDue' | 'totalAmount' | 'insuranceCoveragePercent' | 'payments' | 'chargeReversedAt'>): number {
  if (!OPEN_STATUSES.includes(bill.status) || bill.chargeReversedAt) return 0;
  const balance = Math.max(cents(bill.balanceDue || 0), 0);
  const pct = bill.insuranceCoveragePercent ?? 0;
  if (!(pct > 0)) return balance / 100;
  const insurerShare = cents(((bill.totalAmount || 0) * Math.min(pct, 100)) / 100);
  const insurerPaid = (bill.payments || [])
    .filter(p => p.method === 'insurance' && !(p as { reversed?: boolean }).reversed)
    .reduce((sum, p) => sum + cents(p.amount || 0), 0);
  return Math.max(balance - Math.max(insurerShare - insurerPaid, 0), 0) / 100;
}

export async function encounterPatientOwed(
  patientId: string,
  encounter: { _id: string; visitBilling?: { payment?: string } },
  scope: DataScope,
): Promise<number> {
  // A non-paying visit owes nothing, whatever was charged to it.
  if (encounter.visitBilling?.payment === 'non_paying') return 0;
  const { getBillsByPatient } = await import('./billing-service');
  const bills = (await getBillsByPatient(patientId, scope)).filter(b => b.encounterId === encounter._id && b.status !== 'draft');
  if (bills.length > 0) {
    return bills.reduce((sum, b) => sum + cents(patientShareDue(b)), 0) / 100;
  }
  // No bill for the visit: a charge posted straight to the ledger under the
  // visit's id still counts (never the patient's other visits).
  // A payment taken without the visit's id lowers only the account, so the
  // visit's figure is capped by the account balance: never more than the
  // patient owes in all.
  const { getEncounterLedger, getPatientBalance } = await import('./ledger-service');
  const entries = filterByScope(await getEncounterLedger(encounter._id), scope);
  const visit = entries.reduce((sum, e) => sum + cents(e.amount), 0);
  const account = cents(await getPatientBalance(patientId, scope));
  return Math.max(Math.min(visit, account), 0) / 100;
}
