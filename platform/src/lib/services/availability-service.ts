import { availabilityDB } from '../db';
import { resolveDocOrgId } from './register-org';
import type { AvailabilityBreak, AvailabilityDoc } from '../db-types';
import { appliesOnDate as appliesOnDatePure, firstClash, planSegments, validateDayPlan, type DayPlanProblem } from '../availability-plan';
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
  return appliesOnDatePure(window, date);
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
    throw new Error('Enter the provider, date, start time and end time.');
  }
  if (toMinutes(data.endTime) <= toMinutes(data.startTime)) {
    throw new Error('Enter an end time after the start time.');
  }

  const orgId = await resolveDocOrgId({ orgId: data.orgId, facilityId: data.facilityId }, 'availability window');
  const db = availabilityDB();
  const now = new Date().toISOString();

  // Reject windows that overlap an existing window for the same provider on
  // any day both cover (recurrence included).
  const existing = await getAvailabilityByProvider(data.providerId);
  assertNoClash(existing, [{ date: data.date, startTime: data.startTime, endTime: data.endTime, recurrence: data.recurrence }]);

  const doc: AvailabilityDoc = {
    _id: `avail-${uuidv4()}`,
    type: 'availability',
    status: 'open',
    ...data,
    orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_AVAILABILITY', actorId, actorName,
    `Availability ${doc._id}: provider ${data.providerId} on ${data.date} ${data.startTime}–${data.endTime} (${data.modality})`);
  return doc;
}

const BREAK_LABEL: Record<AvailabilityBreak['kind'], string> = {
  lunch: 'lunch', tea: 'tea break', ward_round: 'ward round', theatre: 'theatre',
  meeting: 'meeting', prayer: 'prayer', other: 'break',
};

/** Thrown when a plan breaks a rule; `problem` is the i18n key the form shows. */
export class DayPlanError extends Error {
  constructor(readonly problem: DayPlanProblem, message: string) { super(message); }
}

const PROBLEM_MESSAGE: Record<DayPlanProblem, string> = {
  'clinicHours.errorTimes': 'Enter a start and end time.',
  'clinicHours.errorEndBeforeStart': 'Enter an end time after the start time.',
  'clinicHours.errorBreakTimes': 'Enter a break end time after its start time.',
  'clinicHours.errorBreakOutside': 'Move the break inside the working hours.',
  'clinicHours.errorBreakOverlap': 'Breaks overlap. Change one of the break times.',
  'clinicHours.errorNoBookableTime': 'No bookable time left after the breaks. Shorten a break or the slot length.',
  'clinicHours.errorNoDays': 'Choose at least one day of the week.',
  'clinicHours.errorUntil': 'Enter a repeat end date on or after the first day.',
};

function assertNoClash(
  existing: AvailabilityDoc[],
  candidates: Pick<AvailabilityDoc, 'date' | 'startTime' | 'endTime' | 'recurrence'>[],
): void {
  for (const candidate of candidates) {
    for (const window of existing) {
      const on = firstClash(window, { ...candidate, status: 'open' });
      if (on) {
        throw new Error(`This overlaps clinic hours already published for ${on} (${window.dayStart ?? window.startTime}–${window.dayEnd ?? window.endTime}). Choose a different time, or remove those hours first.`);
      }
    }
  }
}

/**
 * Publish a working day with its breaks: one window per bookable stretch,
 * written together. Every stretch is checked (rules, then clashes with the
 * clinician's other hours) before anything is written, so a plan is published
 * whole or not at all.
 */
export async function createAvailabilityPlan(
  data: Omit<AvailabilityDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status' | 'startTime' | 'endTime' | 'dayPlanId' | 'dayStart' | 'dayEnd'> & {
    dayStart: string;
    dayEnd: string;
    breaks: AvailabilityBreak[];
  },
  actorId?: string,
  actorName?: string,
): Promise<AvailabilityDoc[]> {
  if (!data.providerId || !data.date) throw new Error('Enter the clinician and the date.');
  const problem = validateDayPlan({ start: data.dayStart, end: data.dayEnd, breaks: data.breaks, slotMinutes: data.slotMinutes });
  if (problem) throw new DayPlanError(problem.problem, PROBLEM_MESSAGE[problem.problem]);
  if (data.recurrence) {
    if (!data.recurrence.daysOfWeek.length) throw new DayPlanError('clinicHours.errorNoDays', PROBLEM_MESSAGE['clinicHours.errorNoDays']);
    if (!data.recurrence.until || data.recurrence.until < data.date) throw new DayPlanError('clinicHours.errorUntil', PROBLEM_MESSAGE['clinicHours.errorUntil']);
  }

  const segments = planSegments(data.dayStart, data.dayEnd, data.breaks);
  const existing = await getAvailabilityByProvider(data.providerId);
  assertNoClash(existing, segments.map(seg => ({ date: data.date, startTime: seg.start, endTime: seg.end, recurrence: data.recurrence })));

  const orgId = await resolveDocOrgId({ orgId: data.orgId, facilityId: data.facilityId }, 'availability window');
  const now = new Date().toISOString();
  const dayPlanId = `plan-${uuidv4()}`;
  const breaks = [...data.breaks].sort((a, b) => a.start.localeCompare(b.start));
  const docs: AvailabilityDoc[] = segments.map(seg => ({
    ...data,
    _id: `avail-${uuidv4()}`,
    type: 'availability',
    status: 'open',
    startTime: seg.start,
    endTime: seg.end,
    dayPlanId,
    breaks,
    orgId,
    createdAt: now,
    updatedAt: now,
  }));
  const results = await availabilityDB().bulkDocs(docs);
  const failed = results.filter(r => 'error' in r && r.error);
  if (failed.length) {
    // Roll back what did land, so the desk never sees half a day.
    const landed = results.filter(r => !('error' in r && r.error)) as { id: string; rev: string }[];
    await availabilityDB().bulkDocs(landed.map(r => ({ _id: r.id, _rev: r.rev, _deleted: true }))).catch(() => undefined);
    throw new Error('Clinic hours not published. Try again.');
  }
  results.forEach((r, i) => { docs[i]._rev = (r as { rev: string }).rev; });
  const breakText = breaks.length ? `, breaks ${breaks.map(b => `${BREAK_LABEL[b.kind]} ${b.start}–${b.end}`).join(', ')}` : '';
  await logAuditSafe('CREATE_AVAILABILITY', actorId, actorName,
    `Clinic hours ${dayPlanId}: provider ${data.providerId} from ${data.date} ${data.dayStart}–${data.dayEnd}${breakText}${data.recurrence ? ` repeating on days ${data.recurrence.daysOfWeek.join(',')} until ${data.recurrence.until}` : ''}`);
  return docs;
}

/**
 * Take a clinician's hours off one day, as the desk's Clinic hours list
 * offers it: a repeating series gets the date as an exception (the other
 * weeks stand), a one-off day is cancelled. A plan's stretches go together.
 */
export async function withdrawAvailabilityOn(window: AvailabilityDoc, date: string, actorId?: string, actorName?: string): Promise<void> {
  const db = availabilityDB();
  const group = window.dayPlanId
    ? (await findByType<AvailabilityDoc>(db, 'availability')).filter(d => d.dayPlanId === window.dayPlanId && d.status !== 'cancelled')
    : [await db.get(window._id) as AvailabilityDoc];
  const now = new Date().toISOString();
  const updated = group.map(d => (d.recurrence
    ? { ...d, recurrence: { ...d.recurrence, exceptions: [...new Set([...(d.recurrence.exceptions ?? []), date])].sort() }, updatedAt: now }
    : { ...d, status: 'cancelled' as const, updatedAt: now }));
  const results = await db.bulkDocs(updated);
  if (results.some(r => 'error' in r && r.error)) throw new Error('Clinic hours not removed. Refresh and try again.');
  await logAuditSafe('CANCEL_AVAILABILITY', actorId, actorName,
    `Withdrew clinic hours ${window.dayPlanId ?? window._id} on ${date} (${updated.length} windows)`);
}

export async function cancelAvailability(id: string, actorId?: string, actorName?: string): Promise<void> {
  const db = availabilityDB();
  const existing = await db.get(id) as AvailabilityDoc;
  const updated: AvailabilityDoc = { ...existing, status: 'cancelled', updatedAt: new Date().toISOString() };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('CANCEL_AVAILABILITY', actorId, actorName, `Cancelled availability ${id}`);
}
