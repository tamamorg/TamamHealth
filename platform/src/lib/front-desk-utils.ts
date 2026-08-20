import type { PatientDoc } from '@/lib/db-types';
import { formatClockTime } from '@/lib/format-utils';
import { toIsoDate, todayIso } from '@/lib/date-utils';

// Exam rooms / bays a walk-in patient can be placed in to meet the provider.
// Fallback used only when facility settings provide no rooms.
export const ROOM_OPTIONS = ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Bay A', 'Bay B', 'Bay C', 'Bay D'];

// Half-hour clinic slots (07:00–18:30) offered when reception reschedules.
export const RESCHEDULE_SLOTS = Array.from({ length: 24 }, (_, i) => {
  const hour = 7 + Math.floor(i / 2);
  return `${String(hour).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
});

export const COMPLAINT_DEPARTMENT_MAP: Record<string, string> = {
  fever: 'General Medicine', malaria: 'General Medicine', cough: 'General Medicine',
  headache: 'General Medicine', pregnancy: 'Maternity', anc: 'Maternity',
  antenatal: 'Maternity', injury: 'Emergency', wound: 'Emergency',
  fracture: 'Emergency', accident: 'Emergency', child: 'Pediatrics',
  pediatric: 'Pediatrics', infant: 'Pediatrics', eye: 'Ophthalmology',
  vision: 'Ophthalmology', dental: 'Dental', tooth: 'Dental',
  skin: 'Dermatology', rash: 'Dermatology',
};

export function suggestDepartment(complaint: string): string {
  const lower = complaint.toLowerCase();
  for (const [keyword, dept] of Object.entries(COMPLAINT_DEPARTMENT_MAP)) {
    if (lower.includes(keyword)) return dept;
  }
  return 'General Medicine';
}

// Split a timestamp into separate date / time pieces so the queue can show them
// in their own columns. Date-only values (e.g. "YYYY-MM-DD") yield an empty time.
export function splitDateTime(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' };
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = /T\d{2}:\d{2}/.test(iso) ? formatClockTime(d) : '';
  return { date, time };
}

// Combine an appointment's day with its "HH:MM" slot into one real moment, so
// the schedule row can count down to it ("in 2h 15m"). Parsed without a zone
// suffix on purpose: appointment slots are wall-clock times at the facility,
// which is how the rest of the client reads "today".
export function appointmentMoment(appointmentDate?: string | null, appointmentTime?: string | null): string | undefined {
  const slot = (appointmentTime || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!slot) return undefined;
  const day = isoDateKey(appointmentDate);
  const at = new Date(`${day}T${slot[1].padStart(2, '0')}:${slot[2]}:00`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

export function formatDayMonthYear(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function isoDateKey(value?: string | null): string {
  if (!value) return todayIso();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? todayIso() : toIsoDate(date);
}

// Final-checkout target: closing out a completed visit at the front desk.
export interface CheckoutTarget {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  encounterId?: string;
  /** Set when the queue entry came from an appointment. */
  appointmentId?: string;
  /** Set when the queue entry came from triage (walk-in). */
  triageId?: string;
}

export function patientFacilityName(patient: PatientDoc | undefined, fallback = 'Facility'): string {
  return (patient as (PatientDoc & { registrationHospitalName?: string }) | undefined)?.registrationHospitalName || fallback;
}
