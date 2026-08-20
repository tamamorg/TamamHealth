/**
 * Payroll service — monthly salary register per staff member. Kept
 * intentionally simple: a single allowances total + single deductions
 * total per row. Detailed line items can be added later if a facility
 * needs statutory split-out.
 */
import { payrollEntriesDB } from '../db';
import type { PayrollEntryDoc, PayrollStatus } from '../db-types-hr';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';

export async function getAllPayrollEntries(scope?: DataScope): Promise<PayrollEntryDoc[]> {
  const db = payrollEntriesDB();
  const all = (await findByType<PayrollEntryDoc>(db, 'payroll_entry'))
    .sort((a, b) => (b.period || '').localeCompare(a.period || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getPayrollByPeriod(period: string, scope?: DataScope): Promise<PayrollEntryDoc[]> {
  const all = await getAllPayrollEntries(scope);
  return all.filter(e => e.period === period);
}

export interface CreatePayrollInput {
  userId: string;
  userName: string;
  role: string;
  facilityId: string;
  facilityName: string;
  period: string;
  baseSalary: number;
  allowances?: number;
  deductions?: number;
  currency?: string;
  notes?: string;
  orgId?: string;
}

export async function createPayrollEntry(input: CreatePayrollInput): Promise<PayrollEntryDoc> {
  const db = payrollEntriesDB();
  const now = new Date().toISOString();
  const allowances = input.allowances || 0;
  const deductions = input.deductions || 0;
  const doc: PayrollEntryDoc = {
    _id: `pay-${uuidv4()}`,
    type: 'payroll_entry',
    userId: input.userId,
    userName: input.userName,
    role: input.role,
    facilityId: input.facilityId,
    facilityName: input.facilityName,
    period: input.period,
    baseSalary: input.baseSalary,
    allowances,
    deductions,
    netPay: input.baseSalary + allowances - deductions,
    currency: input.currency || 'SSP',
    status: 'draft',
    notes: input.notes,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('PAYROLL_ENTRY_CREATED', undefined, undefined,
    `Payroll for ${input.userName} (${input.period}): ${doc.netPay} ${doc.currency}`);
  emitSyncEvent({
    resourceType: 'payroll_entry',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function setPayrollStatus(
  id: string,
  status: PayrollStatus,
  actor: { id: string; name: string },
): Promise<PayrollEntryDoc | null> {
  const db = payrollEntriesDB();
  try {
    const existing = await db.get(id) as PayrollEntryDoc;
    const now = new Date().toISOString();
    existing.status = status;
    if (status === 'paid') {
      existing.paidAt = now;
      existing.paidBy = actor.id;
      existing.paidByName = actor.name;
    }
    existing.updatedAt = now;
    const resp = await db.put(existing);
    existing._rev = resp.rev;
    await logAuditSafe('PAYROLL_STATUS', actor.id, actor.name,
      `${existing.userName} ${existing.period} → ${status}`);
    emitSyncEvent({
      resourceType: 'payroll_entry',
      resourceId: existing._id,
      operation: 'update',
      resourceVersion: existing._rev,
      orgId: existing.orgId,
      hospitalId: existing.facilityId,
    });
    return existing;
  } catch {
    return null;
  }
}

export async function updatePayrollEntry(id: string, updates: Partial<PayrollEntryDoc>): Promise<PayrollEntryDoc | null> {
  const db = payrollEntriesDB();
  try {
    const existing = await db.get(id) as PayrollEntryDoc;
    const merged: PayrollEntryDoc = { ...existing, ...updates, _id: existing._id, _rev: existing._rev, type: 'payroll_entry', updatedAt: new Date().toISOString() };
    merged.netPay = merged.baseSalary + merged.allowances - merged.deductions;
    const resp = await db.put(merged);
    merged._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'payroll_entry',
      resourceId: merged._id,
      operation: 'update',
      resourceVersion: merged._rev,
      orgId: merged.orgId,
      hospitalId: merged.facilityId,
    });
    return merged;
  } catch {
    return null;
  }
}

export async function deletePayrollEntry(id: string): Promise<boolean> {
  const db = payrollEntriesDB();
  try {
    const existing = await db.get(id);
    const typed = existing as unknown as PayrollEntryDoc;
    await db.remove(existing);
    emitSyncEvent({
      resourceType: 'payroll_entry',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
      hospitalId: typed.facilityId,
    });
    return true;
  } catch {
    return false;
  }
}

export interface PayrollSummary {
  total: number;
  approved: number;
  paid: number;
  draft: number;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
}

export async function getPayrollSummary(period: string, scope?: DataScope): Promise<PayrollSummary> {
  const all = await getPayrollByPeriod(period, scope);
  return {
    total: all.length,
    approved: all.filter(e => e.status === 'approved').length,
    paid: all.filter(e => e.status === 'paid').length,
    draft: all.filter(e => e.status === 'draft').length,
    totalGross: all.reduce((s, e) => s + e.baseSalary + e.allowances, 0),
    totalNet: all.reduce((s, e) => s + e.netPay, 0),
    totalDeductions: all.reduce((s, e) => s + e.deductions, 0),
  };
}
