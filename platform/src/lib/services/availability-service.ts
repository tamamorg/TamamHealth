import { availabilityDB } from '../db';
import type { AvailabilityDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';

export async function getAllAvailability(scope?: DataScope): Promise<AvailabilityDoc[]> {
  const db = availabilityDB();
  const all = (await findByType<AvailabilityDoc>(db, 'availability'))
    .filter(d => d && d.status !== 'cancelled')
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  return scope ? filterByScope(all, scope) : all;
}

export async function getAvailabilityByProvider(providerId: string): Promise<AvailabilityDoc[]> {
  const all = await getAllAvailability();
  return all.filter(a => a.providerId === providerId);
}

/**
 * Availability windows that actually apply on a given date.
 *
 * A window is either dated (it applies on its own day) or recurring (it applies
 * on the weekdays in its pattern, until its end date, minus exceptions). Every
 * caller asking "who is available today?" must go through this rather than
 * matching `doc.date === today`, which silently sees nothing for a clinic that
 * runs every Monday.
 */
export async function getAvailabilityOnDate(date: string, scope?: DataScope): Promise<AvailabilityDoc[]> {
  const all = await getAllAvailability(scope);
  return all.filter(a => appliesOnDate(a, date));
}

/** Whether one window covers a given date, recurrence included. */
export function appliesOnDate(window: AvailabilityDoc, date: string): boolean {
  if (window.status === 'cancelled') return false;
  if (!window.recurrence) return window.date === date;

  const { daysOfWeek, until, exceptions } = window.recurrence;
  if (!daysOfWeek?.length) return false;
  if (date < window.date || date > until) return false;
  if (exceptions?.includes(date)) return false;

  // Parsed as UTC so the weekday cannot shift with the reader's timezone.
  const [y, m, d] = date.split('-').map(Number);
  return daysOfWeek.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

/** Whether a provider is inside a window right now, for presence indicators. */
export function isProviderAvailableAt(
  windows: AvailabilityDoc[],
  providerId: string,
  date: string,
  time: string,
): boolean {
  return windows.some(w =>
    w.providerId === providerId &&
    appliesOnDate(w, date) &&
    w.startTime <= time && w.endTime >= time);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export async function createAvailability(
  data: Omit<AvailabilityDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'> & { status?: AvailabilityDoc['status'] },
  actorId?: string,
  actorName?: string,
): Promise<AvailabilityDoc> {
  if (!data.providerId || !data.date || !data.startTime || !data.endTime) {
    throw new Error('Provider, date, start time and end time are required');
  }
  if (toMinutes(data.endTime) <= toMinutes(data.startTime)) {
    throw new Error('End time must be after start time');
  }

  const db = availabilityDB();
  const now = new Date().toISOString();

  // Reject windows that overlap an existing window for the same provider/day.
  const existing = await getAvailabilityByProvider(data.providerId);
  const clash = existing.find(a =>
    a.date === data.date &&
    toMinutes(data.startTime) < toMinutes(a.endTime) &&
    toMinutes(a.startTime) < toMinutes(data.endTime)
  );
  if (clash) {
    throw new Error(`Overlaps an existing availability window (${clash.startTime}–${clash.endTime}) on ${clash.date}`);
  }

  const doc: AvailabilityDoc = {
    _id: `avail-${uuidv4()}`,
    type: 'availability',
    status: 'open',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_AVAILABILITY', actorId, actorName,
    `Availability ${doc._id}: ${data.providerName} on ${data.date} ${data.startTime}–${data.endTime} (${data.modality})`);
  return doc;
}

export async function cancelAvailability(id: string, actorId?: string, actorName?: string): Promise<void> {
  const db = availabilityDB();
  const existing = await db.get(id) as AvailabilityDoc;
  const updated: AvailabilityDoc = { ...existing, status: 'cancelled', updatedAt: new Date().toISOString() };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('CANCEL_AVAILABILITY', actorId, actorName, `Cancelled availability ${id}`);
}
