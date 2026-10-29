import { recurrenceDates, createBookingSeries, type NewAppointment } from '@/lib/booking/recurring-series';
import type { AppointmentDoc } from '@/lib/db-types';

describe('recurrenceDates', () => {
  it('steps weeks and fortnights', () => {
    expect(recurrenceDates('2031-03-04', 'weekly', 3)).toEqual(['2031-03-04', '2031-03-11', '2031-03-18']);
    expect(recurrenceDates('2031-03-04', 'biweekly', 2)).toEqual(['2031-03-04', '2031-03-18']);
  });
  it('steps calendar months and clamps to month end', () => {
    expect(recurrenceDates('2031-01-31', 'monthly', 3)).toEqual(['2031-01-31', '2031-02-28', '2031-03-31']);
    expect(recurrenceDates('2031-11-30', 'quarterly', 2)).toEqual(['2031-11-30', '2032-02-29']);
  });
  it('caps the series length', () => {
    expect(recurrenceDates('2031-03-04', 'weekly', 99)).toHaveLength(12);
  });
});

describe('createBookingSeries', () => {
  const base = { appointmentDate: '2031-03-04', appointmentTime: '10:00' } as NewAppointment;
  const fake = (failOn: string[] = []) => {
    const made: NewAppointment[] = [];
    const create = async (data: NewAppointment) => {
      if (failOn.includes(data.appointmentDate)) throw new Error(`clash on ${data.appointmentDate}`);
      made.push(data);
      return { ...data, _id: `apt-${made.length}` } as AppointmentDoc;
    };
    return { made, create };
  };

  it('books one visit when not recurring', async () => {
    const { made, create } = fake();
    const r = await createBookingSeries(base, create);
    expect(made).toHaveLength(1);
    expect(made[0].isRecurring).toBe(false);
    expect(r.skipped).toEqual([]);
  });

  it('books every occurrence and skips the ones that clash', async () => {
    const { made, create } = fake(['2031-03-18']);
    const r = await createBookingSeries(base, create, { pattern: 'weekly', count: 4 });
    expect(made.map(m => m.appointmentDate)).toEqual(['2031-03-04', '2031-03-11', '2031-03-25']);
    expect(made.every(m => m.isRecurring && m.recurrencePattern === 'weekly')).toBe(true);
    expect(r.skipped).toEqual([{ date: '2031-03-18', reason: 'clash on 2031-03-18' }]);
  });

  it('fails the whole booking when the first visit clashes', async () => {
    const { create } = fake(['2031-03-04']);
    await expect(createBookingSeries(base, create, { pattern: 'weekly', count: 3 })).rejects.toThrow('clash on 2031-03-04');
  });
});
