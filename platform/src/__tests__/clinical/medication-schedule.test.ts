import {
  isScheduledDoseAllowed,
  scheduleForFrequency,
  scheduledForIso,
} from '@/lib/clinical-flow/medication-schedule';
import type { PrescriptionDoc } from '@/lib/db-types';

const rx = {
  _id: 'rx-1', type: 'prescription', patientId: 'p-1', patientName: 'Patient',
  medication: 'Artesunate', dose: '120 mg', route: 'IV', frequency: 'q12h',
  duration: '3 days', prescribedBy: 'Dr. Akol', status: 'pending',
  createdAt: '2026-08-24T06:00:00.000Z', updatedAt: '2026-08-24T06:00:00.000Z',
} as PrescriptionDoc;

describe('medication schedule', () => {
  it('anchors interval orders to their start time in the Juba clinical day', () => {
    expect(scheduleForFrequency(rx.frequency, rx.createdAt)).toEqual(['08:00', '20:00']);
    expect(isScheduledDoseAllowed(rx, scheduledForIso('2026-08-24', '08:00'))).toBe(true);
    expect(isScheduledDoseAllowed(rx, scheduledForIso('2026-08-24', '12:00'))).toBe(false);
  });

  it('does not turn an unknown frequency into a PRN order', () => {
    expect(scheduleForFrequency('use as directed', rx.createdAt)).toEqual([]);
  });

  it('stops generating doses after the stated course', () => {
    expect(isScheduledDoseAllowed(rx, scheduledForIso('2026-08-27', '08:00'))).toBe(false);
  });

  // The chart's Prescribe form writes the labelled frequencies "Nocte (At
  // night)" and "STAT (Immediately)". Both matched no rule and returned [], so
  // the dose produced no MAR row at all — a night or stat dose was invisible to
  // the nurse (patient-safety bug found 2026-11-05).
  it('schedules "Nocte (At night)" as one evening dose', () => {
    expect(scheduleForFrequency('Nocte (At night)')).toEqual(['22:00']);
    expect(scheduleForFrequency('nocte')).toEqual(['22:00']);
  });

  it('schedules a STAT order as a single dose at the ordering time, not repeating', () => {
    // createdAt 06:00 UTC = 08:00 in the Juba clinical day.
    expect(scheduleForFrequency('STAT (Immediately)', rx.createdAt)).toEqual(['08:00']);
    const statRx = { ...rx, frequency: 'STAT (Immediately)', duration: '' } as PrescriptionDoc;
    expect(isScheduledDoseAllowed(statRx, scheduledForIso('2026-08-24', '08:00'))).toBe(true);
    // The next day's slot must NOT be generated — STAT is given once.
    expect(isScheduledDoseAllowed(statRx, scheduledForIso('2026-08-25', '08:00'))).toBe(false);
  });
});

describe('the prescribe form\'s own sigs', () => {
  // "Twice daily with food" and "Three times daily after meals" contain
  // "daily", and the once-daily rule used to match first: the MAR showed one
  // dose a day for a BD or TDS order (found 2026-10-29 on a ward MAR).
  it.each([
    ['Once daily', ['08:00']],
    ['Twice daily with food', ['08:00', '20:00']],
    ['Three times daily after meals', ['08:00', '14:00', '22:00']],
    ['At bedtime', ['22:00']],
  ])('%s', (sig, slots) => {
    expect(scheduleForFrequency(sig)).toEqual(slots);
  });

  it('reads "Every 8 hours" like q8h', () => {
    const anchor = '2026-10-29T06:00:00.000Z'; // 08:00 in Juba
    expect(scheduleForFrequency('Every 8 hours until the course is finished', anchor)).toEqual(['00:00', '08:00', '16:00']);
    expect(scheduleForFrequency('q8h', anchor)).toEqual(['00:00', '08:00', '16:00']);
  });
});
