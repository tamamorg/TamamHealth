import { appointmentAmendRefusalMessage } from '@/lib/appointment-amend-message';
import { AppointmentAmendNotAllowedError } from '@/lib/services/appointment-service';
import en from '@/lib/i18n/locales/en';
import apd from '@/lib/i18n/locales/apd';

function translator(dict: Record<string, string>) {
  return (key: string, params?: Record<string, string | number>) =>
    (dict[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(params?.[k] ?? ''));
}

describe('appointmentAmendRefusalMessage', () => {
  const err = new AppointmentAmendNotAllowedError(['appointmentDate', 'appointmentTime', 'providerName', 'providerId']);

  it('names the fields in the reader\'s words, de-duplicated', () => {
    expect(appointmentAmendRefusalMessage(err, translator(en as Record<string, string>)))
      .toBe('Only reception can change the date, the time, the provider of a booked appointment. Ask reception to reschedule or re-route it.');
  });

  it('carries no English into the Juba Arabic message', () => {
    const msg = appointmentAmendRefusalMessage(err, translator(apd as Record<string, string>))!;
    expect(msg).not.toMatch(/[A-Za-z]/);
  });

  it('ignores other errors', () => {
    expect(appointmentAmendRefusalMessage(new Error('x'), translator({}))).toBeNull();
  });
});
