import type { PrescriptionDoc } from '../db-types';

const JUBA_OFFSET = '+02:00';

export function isPrnFrequency(frequency: string): boolean {
  const value = (frequency || '').trim().toLowerCase();
  return value.includes('prn') || value.includes('as needed') || value.includes('as required');
}

function jubaClock(iso?: string): { hour: number; minute: number } {
  if (!iso) return { hour: 0, minute: 0 };
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return { hour: 0, minute: 0 };
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Juba', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return {
    hour: Number(parts.find(part => part.type === 'hour')?.value || 0),
    minute: Number(parts.find(part => part.type === 'minute')?.value || 0),
  };
}

/** Clinical-round clock labels. Unknown text is not silently treated as PRN. */
export function scheduleForFrequency(frequency: string, anchorIso?: string): string[] {
  const value = (frequency || '').trim().toLowerCase();
  if (!value) return [];
  if (isPrnFrequency(value)) return ['PRN'];
  if (value === 'od' || value === 'qd' || value.includes('once') || value.includes('daily')) return ['08:00'];
  if (value === 'bd' || value === 'bid' || value.includes('twice')) return ['08:00', '20:00'];
  if (value === 'tds' || value === 'tid' || value.includes('three times') || value.includes('thrice')) return ['08:00', '14:00', '22:00'];
  if (value === 'qds' || value === 'qid' || value.includes('four times')) return ['00:00', '06:00', '12:00', '18:00'];
  const intervalMatch = value.match(/q\s*(\d+)\s*h/);
  if (!intervalMatch) return [];
  const interval = Number(intervalMatch[1]);
  if (!Number.isInteger(interval) || interval < 1 || interval > 24) return [];
  const anchor = jubaClock(anchorIso);
  const startMinutes = anchor.hour * 60 + anchor.minute;
  const rows: string[] = [];
  for (let minutes = startMinutes; minutes < 1440; minutes += interval * 60) {
    rows.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  for (let minutes = startMinutes - interval * 60; minutes >= 0; minutes -= interval * 60) {
    rows.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  return rows.sort();
}

export function scheduledForIso(day: string, time: string): string {
  if (time === 'PRN') return new Date().toISOString();
  return new Date(`${day}T${time}:00${JUBA_OFFSET}`).toISOString();
}

export function statedDurationDays(duration: string): number | null {
  const text = (duration || '').trim().toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(day|week|month|hour|hr)/);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2];
    const days = unit.startsWith('week') ? value * 7 : unit.startsWith('month') ? value * 30 : unit.startsWith('hour') || unit === 'hr' ? value / 24 : value;
    return value > 0 ? days : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) > 0 ? Number(text) : null;
  return null;
}

export function doseExpansionCutoff(rx: Pick<PrescriptionDoc, 'stoppedAt' | 'createdAt' | 'effectiveOn' | 'duration'>): number | null {
  if (rx.stoppedAt) {
    const stopped = new Date(rx.stoppedAt).getTime();
    if (Number.isFinite(stopped)) return stopped;
  }
  const days = statedDurationDays(rx.duration);
  const start = rx.effectiveOn ? new Date(`${rx.effectiveOn}T00:00:00${JUBA_OFFSET}`).getTime() : new Date(rx.createdAt).getTime();
  return days !== null && Number.isFinite(start) ? start + days * 86_400_000 : null;
}

export function isScheduledDoseAllowed(rx: PrescriptionDoc, scheduledFor: string): boolean {
  if (isPrnFrequency(rx.frequency)) return Number.isFinite(new Date(scheduledFor).getTime());
  const when = new Date(scheduledFor).getTime();
  if (!Number.isFinite(when)) return false;
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Juba', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(when));
  const effectiveStart = rx.effectiveOn ? new Date(`${rx.effectiveOn}T00:00:00${JUBA_OFFSET}`).getTime() : new Date(rx.createdAt).getTime();
  const cutoff = doseExpansionCutoff(rx);
  return scheduleForFrequency(rx.frequency, rx.createdAt).includes(clock)
    && when >= effectiveStart
    && (cutoff === null || when < cutoff);
}
