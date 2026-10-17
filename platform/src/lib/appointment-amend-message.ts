/**
 * The user-facing text for an `AppointmentAmendNotAllowedError`, in the
 * reader's locale. The service's own `message` is English (it is also the
 * log/test text); screens call this instead of showing `err.message`.
 * Duck-typed on `name` so client code needn't import the service.
 */
type Translate = (key: string, params?: Record<string, string | number>) => string;

const FIELD_KEYS: Record<string, string> = {
  appointmentDate: 'appointments.amendField.date',
  appointmentTime: 'appointments.amendField.time',
  duration: 'appointments.amendField.length',
  departmentId: 'appointments.amendField.department',
  department: 'appointments.amendField.department',
  providerId: 'appointments.amendField.provider',
  providerName: 'appointments.amendField.provider',
  staffId: 'appointments.amendField.nurse',
  staffName: 'appointments.amendField.nurse',
  facilityId: 'appointments.amendField.facility',
  facilityName: 'appointments.amendField.facility',
};

export function appointmentAmendRefusalMessage(err: unknown, t: Translate): string | null {
  if (!(err instanceof Error) || err.name !== 'AppointmentAmendNotAllowedError') return null;
  const fields = (err as Error & { fields?: string[] }).fields ?? [];
  const named = [...new Set(fields.map(f => (FIELD_KEYS[f] ? t(FIELD_KEYS[f]) : f)))];
  return t('appointments.amendNotAllowed', { fields: named.join(', ') });
}
