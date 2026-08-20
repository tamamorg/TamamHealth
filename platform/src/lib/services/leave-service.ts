/**
 * Leave-request service — request / approve / reject / cancel staff leave.
 * Used by the HR module + by individual staff requesting time off.
 */
import { leaveRequestsDB } from '../db';
import type { LeaveRequestDoc, LeaveStatus } from '../db-types-hr';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { jubaDate, jubaYearMonth } from '../time-juba';

export async function getAllLeaveRequests(scope?: DataScope): Promise<LeaveRequestDoc[]> {
  const db = leaveRequestsDB();
  const all = (await findByType<LeaveRequestDoc>(db, 'leave_request'))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return scope ? filterByScope(all, scope) : all;
}

export async function getLeaveRequestsByUser(userId: string): Promise<LeaveRequestDoc[]> {
  const all = await getAllLeaveRequests();
  return all.filter(r => r.userId === userId);
}

export interface CreateLeaveInput {
  userId: string;
  userName: string;
  role: string;
  facilityId: string;
  facilityName: string;
  leaveType: LeaveRequestDoc['leaveType'];
  startDate: string;
  endDate: string;
  reason?: string;
  orgId?: string;
}

function daysBetween(startDate: string, endDate: string): number {
  const a = new Date(startDate).getTime();
  const b = new Date(endDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.max(1, Math.ceil((b - a) / 86400000) + 1);
}

export async function requestLeave(input: CreateLeaveInput): Promise<LeaveRequestDoc> {
  const db = leaveRequestsDB();
  const now = new Date().toISOString();
  const doc: LeaveRequestDoc = {
    _id: `leave-${uuidv4()}`,
    type: 'leave_request',
    ...input,
    days: daysBetween(input.startDate, input.endDate),
    status: 'pending',
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;

  await logAuditSafe('LEAVE_REQUESTED', input.userId, input.userName,
    `${input.userName} requested ${doc.days}d ${input.leaveType} leave (${input.startDate} → ${input.endDate})`);

  emitSyncEvent({
    resourceType: 'leave_request',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function decideLeave(
  id: string,
  decision: { status: Extract<LeaveStatus, 'approved' | 'rejected'>; decidedBy: string; decidedByName: string; decisionNotes?: string },
): Promise<LeaveRequestDoc | null> {
  const db = leaveRequestsDB();
  try {
    const existing = await db.get(id) as LeaveRequestDoc;
    // Segregation of duties: nobody decides their own leave, whatever their
    // role. (Role-based authorization is client-enforced platform-wide — the
    // offline write path has no server chokepoint — but self-approval is a
    // data-level invariant we can hold here.)
    if (existing.userId === decision.decidedBy) {
      throw new Error('A leave request cannot be decided by its requester');
    }
    const now = new Date().toISOString();
    existing.status = decision.status;
    existing.decidedAt = now;
    existing.decidedBy = decision.decidedBy;
    existing.decidedByName = decision.decidedByName;
    existing.decisionNotes = decision.decisionNotes;
    existing.updatedAt = now;
    const resp = await db.put(existing);
    existing._rev = resp.rev;

    await logAuditSafe(decision.status === 'approved' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      decision.decidedBy, decision.decidedByName,
      `${decision.status} ${existing.days}d ${existing.leaveType} for ${existing.userName}`);

    emitSyncEvent({
      resourceType: 'leave_request',
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

export async function cancelLeave(id: string, actor: { id: string; name: string }): Promise<LeaveRequestDoc | null> {
  const db = leaveRequestsDB();
  try {
    const existing = await db.get(id) as LeaveRequestDoc;
    if (existing.status === 'taken') return existing; // can't cancel taken leave
    existing.status = 'cancelled';
    existing.decidedAt = new Date().toISOString();
    existing.decidedBy = actor.id;
    existing.decidedByName = actor.name;
    existing.updatedAt = new Date().toISOString();
    const resp = await db.put(existing);
    existing._rev = resp.rev;
    await logAuditSafe('LEAVE_CANCELLED', actor.id, actor.name,
      `Cancelled ${existing.days}d ${existing.leaveType} for ${existing.userName}`);
    emitSyncEvent({
      resourceType: 'leave_request',
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

export interface LeaveSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  upcoming: number;     // approved + startDate >= today
  daysApprovedThisMonth: number;
}

export async function getLeaveSummary(scope?: DataScope): Promise<LeaveSummary> {
  const all = await getAllLeaveRequests(scope);
  const today = jubaDate();
  const monthStart = jubaYearMonth();
  return {
    total: all.length,
    pending: all.filter(r => r.status === 'pending').length,
    approved: all.filter(r => r.status === 'approved').length,
    rejected: all.filter(r => r.status === 'rejected').length,
    upcoming: all.filter(r => r.status === 'approved' && r.startDate >= today).length,
    daysApprovedThisMonth: all
      .filter(r => r.status === 'approved' && r.startDate.startsWith(monthStart))
      .reduce((s, r) => s + r.days, 0),
  };
}
