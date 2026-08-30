import type { AppointmentPriority, AppointmentType, FacilityLevel } from './db-types';
import type { PaymentMethodType } from './db-types-payments';
import { jubaDate } from './time-juba';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; fields: Record<string, string> };

const PAYMENT_METHODS = new Set<PaymentMethodType>([
  'cash', 'mobile_money', 'mpesa', 'airtel', 'mtn_momo', 'm_gurush', 'card',
  'bank_transfer', 'payment_plan', 'waiver', 'insurance',
]);
const CURRENCIES = new Set(['SSP', 'USD', 'KES', 'UGX']);
const FACILITY_LEVELS = new Set<FacilityLevel>(['boma', 'payam', 'county', 'state', 'national']);
const APPOINTMENT_TYPES = new Set<AppointmentType>([
  'general', 'follow_up', 'specialist', 'anc', 'immunization', 'lab', 'surgical',
  'dental', 'mental_health', 'walk_in',
]);
const APPOINTMENT_PRIORITIES = new Set<AppointmentPriority>(['routine', 'urgent', 'emergency']);

function stringValue(body: Record<string, unknown>, field: string): string {
  return typeof body[field] === 'string' ? body[field].trim() : '';
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function tooLong(value: string, max: number): boolean {
  return value.length > max;
}

export interface ValidPortalPayment {
  amount: number;
  method: PaymentMethodType;
  currency: string;
}

export function validatePortalPayment(body: Record<string, unknown>): ValidationResult<ValidPortalPayment> {
  const fields: Record<string, string> = {};
  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) {
    fields.amount = 'Amount must be a positive finite number';
  }

  const method = stringValue(body, 'method') || 'mobile_money';
  if (!PAYMENT_METHODS.has(method as PaymentMethodType)) fields.method = 'Unsupported payment method';

  const currency = (stringValue(body, 'currency') || 'SSP').toUpperCase();
  if (!CURRENCIES.has(currency)) fields.currency = 'Unsupported currency';

  for (const [field, max] of [['reference', 200], ['mobileMoneyPhone', 40], ['notes', 2_000]] as const) {
    if (tooLong(stringValue(body, field), max)) fields[field] = `Must be ${max} characters or fewer`;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { amount, method: method as PaymentMethodType, currency } };
}

export interface ValidPortalAppointment {
  facilityId: string;
  facilityLevel: FacilityLevel;
  appointmentDate: string;
  appointmentTime: string;
  duration: number;
  appointmentType: AppointmentType;
  priority: AppointmentPriority;
  department: string;
  reason: string;
}

export function validatePortalAppointment(
  body: Record<string, unknown>,
  today: string = jubaDate(),
): ValidationResult<ValidPortalAppointment> {
  const fields: Record<string, string> = {};
  const facilityId = stringValue(body, 'facilityId');
  if (!facilityId) fields.facilityId = 'Facility is required';

  const appointmentDate = stringValue(body, 'appointmentDate');
  if (!validIsoDate(appointmentDate)) fields.appointmentDate = 'Use a valid date in YYYY-MM-DD format';
  else if (appointmentDate < today) fields.appointmentDate = 'Appointment date cannot be in the past';

  const appointmentTime = stringValue(body, 'appointmentTime');
  if (appointmentTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)) {
    fields.appointmentTime = 'Use HH:MM in 24-hour time, or leave blank for any time';
  }

  const rawDuration = body.duration === undefined ? 30 : Number(body.duration);
  if (!Number.isInteger(rawDuration) || rawDuration < 5 || rawDuration > 480) {
    fields.duration = 'Duration must be a whole number from 5 to 480 minutes';
  }

  const facilityLevel = stringValue(body, 'facilityLevel') || 'county';
  if (!FACILITY_LEVELS.has(facilityLevel as FacilityLevel)) fields.facilityLevel = 'Unsupported facility level';

  const appointmentType = stringValue(body, 'appointmentType') || 'general';
  if (!APPOINTMENT_TYPES.has(appointmentType as AppointmentType)) fields.appointmentType = 'Unsupported appointment type';

  const priority = stringValue(body, 'priority') || 'routine';
  if (!APPOINTMENT_PRIORITIES.has(priority as AppointmentPriority)) fields.priority = 'Unsupported priority';

  const department = stringValue(body, 'department') || 'General';
  const reason = stringValue(body, 'reason');
  if (tooLong(department, 120)) fields.department = 'Must be 120 characters or fewer';
  if (tooLong(reason, 2_000)) fields.reason = 'Must be 2000 characters or fewer';

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      facilityId,
      facilityLevel: facilityLevel as FacilityLevel,
      appointmentDate,
      appointmentTime,
      duration: rawDuration,
      appointmentType: appointmentType as AppointmentType,
      priority: priority as AppointmentPriority,
      department,
      reason,
    },
  };
}
