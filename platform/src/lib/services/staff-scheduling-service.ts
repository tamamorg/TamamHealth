import { staffSchedulesDB } from '../db';
import type { StaffScheduleDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { toIsoDate } from '@/lib/date-utils';

export async function getAllSchedules(scope?: DataScope): Promise<StaffScheduleDoc[]> {
  const db = staffSchedulesDB();
  const all = (await findByType<StaffScheduleDoc>(db, 'staff_schedule'))
    .sort((a, b) => {
      const dateA = `${a.shiftDate}T${a.startTime}`;
      const dateB = `${b.shiftDate}T${b.startTime}`;
      return dateA.localeCompare(dateB);
    });
  return scope ? filterByScope(all, scope) : all;
}

export async function getSchedulesByDate(date: string, facilityId?: string, scope?: DataScope): Promise<StaffScheduleDoc[]> {
  const all = await getAllSchedules(scope);
  return all.filter(s =>
    s.shiftDate === date &&
    (!facilityId || s.facilityId === facilityId)
  );
}

export async function getSchedulesByUser(userId: string, scope?: DataScope): Promise<StaffScheduleDoc[]> {
  const all = await getAllSchedules(scope);
  return all.filter(s => s.userId === userId);
}

export async function getOnCallStaff(date: string, facilityId?: string, scope?: DataScope): Promise<StaffScheduleDoc[]> {
  const all = await getAllSchedules(scope);
  return all.filter(s =>
    s.shiftDate === date &&
    s.isOnCall &&
    s.status !== 'absent' &&
    (!facilityId || s.facilityId === facilityId)
  );
}

export async function createSchedule(
  data: Omit<StaffScheduleDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<StaffScheduleDoc> {
  const db = staffSchedulesDB();
  const now = new Date().toISOString();

  const doc: StaffScheduleDoc = {
    _id: `sched-${uuidv4()}`,
    type: 'staff_schedule',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_SCHEDULE', undefined, undefined,
    `Schedule ${doc._id}: ${data.userName} (${data.shiftType}) on ${data.shiftDate}`
  );
  emitSyncEvent({
    resourceType: 'staff_schedule',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updateSchedule(
  id: string,
  updates: Partial<StaffScheduleDoc>,
  scope?: DataScope,
): Promise<StaffScheduleDoc | null> {
  const db = staffSchedulesDB();
  try {
    const existing = await db.get(id) as StaffScheduleDoc;
    if (scope && filterByScope([existing], scope).length === 0) return null;
    const updated = {
      ...existing,
      ...updates,
      orgId: existing.orgId,
      facilityId: existing.facilityId,
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_SCHEDULE', undefined, undefined, `Schedule ${id} updated`);
    emitSyncEvent({
      resourceType: 'staff_schedule',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    return updated;
  } catch {
    return null;
  }
}

export async function deleteSchedule(id: string, scope?: DataScope): Promise<boolean> {
  const db = staffSchedulesDB();
  try {
    const existing = await db.get(id) as StaffScheduleDoc;
    if (scope && filterByScope([existing], scope).length === 0) return false;
    /* istanbul ignore next -- PouchDB always returns _rev on successful get() */
    if (!existing._rev) {
      throw new Error('Cannot delete document without revision');
    }
    await db.remove(existing._id, existing._rev);
    await logAuditSafe('DELETE_SCHEDULE', undefined, undefined, `Schedule ${id} deleted`);
    emitSyncEvent({
      resourceType: 'staff_schedule',
      resourceId: id,
      operation: 'delete',
      orgId: existing.orgId,
      hospitalId: existing.facilityId,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getWeeklyRoster(startDate: string, facilityId?: string, scope?: DataScope): Promise<StaffScheduleDoc[]> {
  const all = await getAllSchedules(scope);
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const endDateStr = toIsoDate(end);

  return all.filter(s =>
    s.shiftDate >= startDate &&
    s.shiftDate < endDateStr &&
    (!facilityId || s.facilityId === facilityId)
  );
}

export async function getStaffingGaps(date: string, facilityId?: string, scope?: DataScope): Promise<{ shift: string; gap: number; requiredStaff: number; currentStaff: number }[]> {
  const schedules = await getSchedulesByDate(date, facilityId, scope);

  // Define minimum staffing requirements by shift
  const requirements: Record<string, number> = {
    morning: 5,
    afternoon: 4,
    night: 3,
    on_call: 2,
  };

  const gaps: { shift: string; gap: number; requiredStaff: number; currentStaff: number }[] = [];

  for (const [shift, required] of Object.entries(requirements)) {
    const staffCount = schedules.filter(s =>
      s.shiftType === shift && s.status !== 'absent'
    ).length;

    if (staffCount < required) {
      gaps.push({
        shift,
        gap: required - staffCount,
        requiredStaff: required,
        currentStaff: staffCount,
      });
    }
  }

  return gaps;
}
