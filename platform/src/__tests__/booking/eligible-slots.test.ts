import { eligibleBookingSlots } from '@/lib/booking/eligible-slots';
import type { Slot } from '@/lib/booking/slot-engine';

const local = { providerId: 'doctor-local', date: '2026-09-11', startTime: '09:00' } as Slot;
const transferred = { ...local, providerId: 'doctor-other-facility' };

describe('eligible booking slots', () => {
  it('excludes published hours belonging to a clinician outside the eligible directory', () => {
    expect(eligibleBookingSlots([local, transferred], [{ _id: 'doctor-local' }])).toEqual([local]);
  });
  it('does not fall back to published clinician names when the directory is unavailable', () => {
    expect(eligibleBookingSlots([local, transferred], [])).toEqual([]);
  });
  it('removes slots when a clinician is no longer eligible', () => {
    expect(eligibleBookingSlots([local], [{ _id: 'doctor-replacement' }])).toEqual([]);
  });
});
