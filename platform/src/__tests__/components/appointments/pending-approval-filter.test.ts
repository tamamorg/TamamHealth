/**
 * The "Pending approval" chip on /appointments (and the list it filters to)
 * used to count `status === 'scheduled'` — a booking reception already made
 * itself — instead of `status === 'requested'`, the portal ask reception
 * actually has to answer. That treated the whole day's confirmed schedule as
 * an approval queue. `isPendingApproval` is the one rule both call sites
 * share now, exported so the fix is directly testable without rendering the
 * calendar page.
 */
import { isPendingApproval } from '@/lib/appointment-workflow';
import type { AppointmentStatus } from '@/lib/db-types';

const today = '2026-08-29';
const appt = (status: AppointmentStatus, appointmentDate = today) => ({ status, appointmentDate });

describe('isPendingApproval', () => {
  it('counts a portal `requested` booking for today or later', () => {
    expect(isPendingApproval(appt('requested'), today)).toBe(true);
    expect(isPendingApproval(appt('requested', '2026-08-30'), today)).toBe(true);
  });

  it('does not count a booking reception already scheduled itself', () => {
    expect(isPendingApproval(appt('scheduled'), today)).toBe(false);
    expect(isPendingApproval(appt('confirmed'), today)).toBe(false);
    expect(isPendingApproval(appt('checked_in'), today)).toBe(false);
  });

  it('does not count a past-dated request — the desk missed its window, not a queue item', () => {
    expect(isPendingApproval(appt('requested', '2026-08-01'), today)).toBe(false);
  });
});
