/** Payment service split: financial-summary. Re-exported through ../payment-service. */
import type { PatientFinancialSummary } from '../../db-types-payments';
import type { DataScope } from '../data-scope';
import { getPatientBalance, getPatientBalanceUnscopedForPortal } from '../ledger-service';
import { jubaDate } from '../../time-juba';
import { getSettings } from '../../settings/settings-store';
import { COLLECTION_STAGE_DAYS } from './shared';
import { readPaymentsByPatient } from './collection';
import { getLatestEligibility, readPatientInsurancePolicies } from './insurance';
import { readPaymentPlansByPatient } from './payment-plans';
import { readInvoicesByPatient } from './invoices';
import { readPatientPaymentMethods } from './saved-methods';

// ═══════════════════════════════════════════════════════════════════
// PATIENT FINANCIAL SUMMARY (Computed)
// ═══════════════════════════════════════════════════════════════════

export async function getPatientFinancialSummary(patientId: string, scope: DataScope): Promise<PatientFinancialSummary> {
  return buildFinancialSummary(patientId, scope);
}

/**
 * UNSCOPED: patient-portal read. The portal authenticates a patient (not a staff
 * DataScope) who legitimately sees their own records across every org that
 * treated them. Caller must pass the verified portal token subject. Never use
 * for staff routes.
 */
export async function getPatientFinancialSummaryUnscopedForPortal(patientId: string): Promise<PatientFinancialSummary> {
  return buildFinancialSummary(patientId, undefined);
}

async function buildFinancialSummary(patientId: string, scope: DataScope | undefined): Promise<PatientFinancialSummary> {
  const [balance, policies, eligibility, payments, plans, methods, invoices] = await Promise.all([
    scope ? getPatientBalance(patientId, scope) : getPatientBalanceUnscopedForPortal(patientId),
    readPatientInsurancePolicies(patientId, scope),
    // Eligibility is a staff-verified, tenant-bound record: the portal never gets it.
    scope ? getLatestEligibility(patientId, scope) : Promise.resolve(null),
    readPaymentsByPatient(patientId, scope),
    readPaymentPlansByPatient(patientId, scope),
    readPatientPaymentMethods(patientId, scope),
    readInvoicesByPatient(patientId, scope),
  ]);

  const activePlans = plans.filter(p => p.status === 'active');
  const activePlanBalance = activePlans.reduce((s, p) => s + p.remainingBalance, 0);
  const today = jubaDate();
  const overdueInvoices = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled' && i.dueDate < today);
  const overdueBalance = overdueInvoices.reduce((s, i) => s + i.totalDue, 0);

  let collectionStage: PatientFinancialSummary['collectionStage'] = 'current';
  if (overdueBalance > 0) {
    const oldestOverdue = overdueInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (oldestOverdue) {
      const stageDays = getSettings().collectionStageDays || COLLECTION_STAGE_DAYS;
      const daysPastDue = Math.floor((Date.now() - new Date(oldestOverdue.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      if (daysPastDue > 120) collectionStage = '120_plus';
      else if (daysPastDue > stageDays.preWriteOff) collectionStage = '90_day';
      else if (daysPastDue > stageDays.warning) collectionStage = '60_day';
      else if (daysPastDue > stageDays.followUp) collectionStage = '30_day';
    }
  }

  const lastPayment = payments[0];
  const nextPlanPayment = activePlans[0];

  return {
    patientId,
    totalBalance: Math.max(0, balance),
    totalInCollections: collectionStage === '120_plus' ? overdueBalance : 0,
    currentBalance: Math.max(0, balance - overdueBalance),
    overdueBalance,
    activePlanBalance,
    insurancePolicies: policies,
    primaryPolicy: policies.find(p => p.isPrimary) || policies[0],
    eligibilityStatus: eligibility?.status || 'none',
    lastPaymentDate: lastPayment?.processedAt,
    lastPaymentAmount: lastPayment?.amount,
    nextPlanPaymentDate: nextPlanPayment?.nextDueDate,
    nextPlanPaymentAmount: nextPlanPayment?.monthlyAmount,
    savedPaymentMethods: methods,
    preferredMethod: methods.find(m => m.isDefault) || methods[0],
    collectionStage,
  };
}
