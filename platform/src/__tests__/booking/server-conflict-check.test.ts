import { serverBookingConflict, withServerConflictCheck } from '@/lib/booking/server-conflict-check';
import { createBookingSeries, type NewAppointment } from '@/lib/booking/recurring-series';
import type { AppointmentDoc } from '@/lib/db-types';

const slot = { appointmentDate: '2031-03-04', appointmentTime: '10:00', duration: 30, providerId: 'dr-a', staffId: 'nurse-s' };

afterEach(() => { jest.restoreAllMocks(); });

describe('serverBookingConflict', () => {
  it('reports the server clash for bookings this device cannot see', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ conflict: 'Not booked. Stella already has Akech Deng at 10:00.' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(serverBookingConflict(slot)).resolves.toMatch(/Stella already has/);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/appointments/conflicts?');
    expect(url).toContain('staffId=nurse-s');
    expect(url).not.toContain('orgId');
  });

  it('never blocks a booking when the server cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(serverBookingConflict(slot)).resolves.toBeNull();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(serverBookingConflict(slot)).resolves.toBeNull();
  });

  it('skips the server when the device is offline', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(serverBookingConflict(slot)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('withServerConflictCheck in a series', () => {
  it('skips an occurrence the server says clashes, and books the rest', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => ({ conflict: String(input).includes('date=2031-03-11') ? 'Not booked. Dr. A is at Wau then.' : null }),
    })) as unknown as typeof fetch;
    const made: string[] = [];
    const create = async (data: NewAppointment) => { made.push(data.appointmentDate); return { ...data, _id: data.appointmentDate } as AppointmentDoc; };
    const r = await createBookingSeries({ ...slot } as NewAppointment, withServerConflictCheck(create), { pattern: 'weekly', count: 3 });
    expect(made).toEqual(['2031-03-04', '2031-03-18']);
    expect(r.skipped).toEqual([{ date: '2031-03-11', reason: 'Not booked. Dr. A is at Wau then.' }]);
  });
});
