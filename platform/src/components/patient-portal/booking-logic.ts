/**
 * Pure logic for the patient-portal booking dialog: week ranges, grouping the
 * slot API's flat list into days, and building the POST bodies. No React, no
 * fetch, so it is unit-testable. All dates are facility-local YYYY-MM-DD.
 */
import { addDaysIso } from '@/lib/date-utils';

export interface PortalSlot {
  providerId: string;
  providerName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export type ContactPreference = 'call' | 'sms' | 'either';

export interface WeekRange { from: string; to: string }

/** 7-day window starting at `start` (inclusive). */
export function weekRange(start: string): WeekRange {
  return { from: start, to: addDaysIso(start, 6) };
}

/** Start of the previous week, never earlier than today. */
export function prevWeekStart(start: string, today: string): string {
  const prev = addDaysIso(start, -7);
  return prev < today ? today : prev;
}

export function nextWeekStart(start: string): string {
  return addDaysIso(start, 7);
}

export interface DayGroup { date: string; slots: PortalSlot[] }

/** One entry per day of the week (empty days included), slots by time then provider. */
export function groupSlotsByDay(slots: PortalSlot[], range: WeekRange): DayGroup[] {
  const days: DayGroup[] = [];
  for (let d = range.from; d <= range.to; d = addDaysIso(d, 1)) days.push({ date: d, slots: [] });
  const byDate = new Map(days.map(d => [d.date, d]));
  for (const s of slots) byDate.get(s.date)?.slots.push(s);
  for (const d of days) {
    d.slots.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.providerName.localeCompare(b.providerName));
  }
  return days;
}

export function slotKey(s: PortalSlot): string {
  return `${s.providerId}|${s.date}|${s.startTime}`;
}

export interface SlotBookingInput {
  visitReasonId: string;
  slot: PortalSlot;
  phone: string;
  contactPreference: ContactPreference;
  notes: string;
}

export function buildSlotBody(i: SlotBookingInput) {
  const notes = i.notes.trim();
  const phone = i.phone.trim();
  return {
    visitReasonId: i.visitReasonId,
    providerId: i.slot.providerId,
    appointmentDate: i.slot.date,
    appointmentTime: i.slot.startTime,
    contactPreference: i.contactPreference,
    ...(phone ? { patientPhone: phone } : {}),
    ...(notes ? { patientNotes: notes } : {}),
  };
}

export interface LegacyBookingInput {
  phone: string;
  facilityId: string;
  facilityName: string;
  date: string;
  reasonText: string;
  state: string;
}

/** "Ask the facility to call me": date only, no slot, no visitReasonId. */
export function buildLegacyBody(i: LegacyBookingInput) {
  return {
    patientPhone: i.phone,
    facilityId: i.facilityId,
    facilityName: i.facilityName,
    appointmentDate: i.date,
    appointmentTime: '',
    department: 'General / OPD',
    reason: i.reasonText,
    appointmentType: 'general',
    state: i.state,
  };
}
