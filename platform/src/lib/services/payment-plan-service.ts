/**
 * Payment Plan Service — patient installment plans. Split out of
 * payment-service.ts; re-exported from there so no caller needs to change.
 */
import type { PaymentPlanDoc, PlanInstallment } from '../db-types-payments';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { paymentPlansDB } from './payment-dbs';

// ═══════════════════════════════════════════════════════════════════
// PAYMENT PLANS
// ═══════════════════════════════════════════════════════════════════

export async function createPaymentPlan(input: {
  patientId: string;
  patientName: string;
  totalBalance: number;
  termMonths: number;
  apr?: number;
  encounterIds: string[];
  autoPayMethodId?: string;
  createdByStaff: string;
  createdByStaffName: string;
  facilityId: string;
  orgId?: string;
}): Promise<PaymentPlanDoc> {
  const db = paymentPlansDB();
  const now = new Date().toISOString();
  const apr = input.apr || 0;
  const monthlyAmount = Math.ceil((input.totalBalance / input.termMonths) * 100) / 100;

  // Generate installment schedule
  const installments: PlanInstallment[] = [];
  const startDate = new Date();
  for (let i = 0; i < input.termMonths; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i + 1);
    dueDate.setDate(1); // Due on the 1st of each month
    const isLast = i === input.termMonths - 1;
    const amt = isLast
      ? Math.round((input.totalBalance - monthlyAmount * (input.termMonths - 1)) * 100) / 100
      : monthlyAmount;
    installments.push({
      number: i + 1,
      dueDate: dueDate.toISOString().slice(0, 10),
      amount: amt,
      status: 'pending',
    });
  }

  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + input.termMonths + 1);

  const doc: PaymentPlanDoc = {
    _id: `plan-${uuidv4().slice(0, 10)}`,
    type: 'payment_plan',
    patientId: input.patientId,
    patientName: input.patientName,
    totalBalance: input.totalBalance,
    termMonths: input.termMonths,
    monthlyAmount,
    apr,
    startDate: now.slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
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
    `Plan for ${input.patientName}: ${input.totalBalance} over ${input.termMonths} months`);

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

export async function getPaymentPlansByPatient(patientId: string): Promise<PaymentPlanDoc[]> {
  const rows = await findByType<PaymentPlanDoc>(paymentPlansDB(), 'payment_plan', { patientId }, { indexFields: ['type', 'patientId'] });
  return rows
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getAllPaymentPlans(scope?: DataScope): Promise<PaymentPlanDoc[]> {
  const db = paymentPlansDB();
  const all = await findByType<PaymentPlanDoc>(db, 'payment_plan');
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function recordPlanPayment(planId: string, installmentNumber: number, paymentId: string, amount: number): Promise<PaymentPlanDoc | null> {
  const db = paymentPlansDB();
  try {
    const plan = await db.get(planId) as PaymentPlanDoc;
    const installment = plan.installments.find(i => i.number === installmentNumber);
    if (installment) {
      installment.status = amount >= installment.amount ? 'paid' : 'partial';
      installment.paidAmount = amount;
      installment.paidDate = new Date().toISOString().slice(0, 10);
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
