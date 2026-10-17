/** Payment service split: payment-plans. Re-exported through ../payment-service. */
import { findByType } from '../db-query';
import type { PaymentPlanDoc, PlanInstallment } from '../../db-types-payments';
import type { DataScope } from '../data-scope';
import { filterByScope } from '../data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { emitSyncEvent } from '../sync-event-service';
import { toIsoDate, todayIso } from '@/lib/date-utils';
import { paymentPlansDB } from './shared';

// ═══════════════════════════════════════════════════════════════════
// PAYMENT PLANS
// ═══════════════════════════════════════════════════════════════════

export async function createPaymentPlan(input: {
  patientId: string;
  patientName: string;
  totalBalance: number;
  currency?: string;
  termMonths: number;
  apr?: number;
  encounterIds: string[];
  autoPayMethodId?: string;
  createdByStaff: string;
  createdByStaffName: string;
  facilityId: string;
  orgId?: string;
}): Promise<PaymentPlanDoc> {
  if (!Number.isFinite(input.totalBalance) || input.totalBalance <= 0 ||
      !Number.isInteger(input.termMonths) || input.termMonths < 1 || input.termMonths > 120 ||
      (input.apr !== undefined && input.apr !== 0) || !/^[A-Z]{3}$/.test(input.currency ?? 'SSP')) {
    throw new Error('INVALID_PAYMENT_PLAN');
  }
  const db = paymentPlansDB();
  const now = new Date().toISOString();
  const apr = input.apr || 0;
  const monthlyAmount = Math.ceil((input.totalBalance / input.termMonths) * 100) / 100;

  // Generate installment schedule
  const installments: PlanInstallment[] = [];
  const startDate = new Date();
  for (let i = 0; i < input.termMonths; i++) {
    const dueDate = new Date(startDate);
    dueDate.setDate(1); // Anchor before adding months to avoid Jan 31 -> March.
    dueDate.setMonth(dueDate.getMonth() + i + 1);
    dueDate.setDate(1); // Due on the 1st of each month
    // Distribute integer minor units; rounding every installment up can make
    // the last one negative for small balances.
    const totalCents = Math.round(input.totalBalance * 100);
    const amt = (Math.floor(totalCents / input.termMonths) + (i < totalCents % input.termMonths ? 1 : 0)) / 100;
    installments.push({
      number: i + 1,
      dueDate: toIsoDate(dueDate),
      amount: amt,
      status: 'pending',
    });
  }

  const endDate = new Date(startDate);
  endDate.setDate(1);
  endDate.setMonth(endDate.getMonth() + input.termMonths);

  const doc: PaymentPlanDoc = {
    _id: `plan-${uuidv4()}`,
    type: 'payment_plan',
    patientId: input.patientId,
    patientName: input.patientName,
    totalBalance: input.totalBalance,
    currency: input.currency ?? 'SSP',
    termMonths: input.termMonths,
    monthlyAmount,
    apr,
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
    status: 'active',
    nextDueDate: installments[0]?.dueDate,
    paidToDate: 0,
    remainingBalance: input.totalBalance,
    missedPayments: 0,
    autoPayEnabled: !!input.autoPayMethodId,
    autoPayMethodId: input.autoPayMethodId,
    encounterIds: input.encounterIds,
    installments,
    createdByStaff: input.createdByStaff,
    createdByStaffName: input.createdByStaffName,
    facilityId: input.facilityId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdByStaff,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  await logAuditSafe('PAYMENT_PLAN_CREATED', input.createdByStaff, input.createdByStaffName,
    `Plan for patient ${input.patientId}: ${input.totalBalance} over ${input.termMonths} months`);

  emitSyncEvent({
    resourceType: 'payment_plan',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function getPaymentPlansByPatient(patientId: string, scope: DataScope): Promise<PaymentPlanDoc[]> {
  return readPaymentPlansByPatient(patientId, scope);
}

/**
 * UNSCOPED: patient-portal read. The portal authenticates a patient (not a staff
 * DataScope) who legitimately sees their own records across every org that
 * treated them. Caller must pass the verified portal token subject. Never use
 * for staff routes.
 */
export async function getPaymentPlansByPatientUnscopedForPortal(patientId: string): Promise<PaymentPlanDoc[]> {
  return readPaymentPlansByPatient(patientId, undefined);
}

export async function readPaymentPlansByPatient(patientId: string, scope: DataScope | undefined): Promise<PaymentPlanDoc[]> {
  const rows = await findByType<PaymentPlanDoc>(paymentPlansDB(), 'payment_plan', { patientId }, { indexFields: ['type', 'patientId'] });
  return (scope ? filterByScope(rows, scope) : rows)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getAllPaymentPlans(scope: DataScope): Promise<PaymentPlanDoc[]> {
  const db = paymentPlansDB();
  const all = await findByType<PaymentPlanDoc>(db, 'payment_plan');
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return filterByScope(all, scope);
}

export async function recordPlanPayment(planId: string, installmentNumber: number, paymentId: string, amount: number): Promise<PaymentPlanDoc | null> {
  const db = paymentPlansDB();
  try {
    const plan = await db.get(planId) as PaymentPlanDoc;
    const installment = plan.installments.find(i => i.number === installmentNumber);
    if (installment) {
      installment.status = amount >= installment.amount ? 'paid' : 'partial';
      installment.paidAmount = amount;
      installment.paidDate = todayIso();
      installment.paymentId = paymentId;
    }

    plan.paidToDate = Math.round((plan.paidToDate + amount) * 100) / 100;
    plan.remainingBalance = Math.round((plan.totalBalance - plan.paidToDate) * 100) / 100;
    plan.lastPaymentDate = new Date().toISOString();

    // Find next pending installment
    const next = plan.installments.find(i => i.status === 'pending');
    plan.nextDueDate = next?.dueDate;

    if (plan.remainingBalance <= 0) {
      plan.status = 'completed';
      plan.remainingBalance = 0;
    }

    plan.updatedAt = new Date().toISOString();
    const resp = await db.put(plan);
    plan._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'payment_plan',
      resourceId: plan._id,
      operation: 'update',
      resourceVersion: plan._rev,
      orgId: plan.orgId,
      hospitalId: plan.facilityId,
    });
    return plan;
  } catch { return null; }
}
