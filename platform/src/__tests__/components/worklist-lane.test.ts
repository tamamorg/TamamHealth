/**
 * Lane filing for the clinical dashboard worklist (computeRowStatusGroup).
 *
 * The regression this guards: a patient whose encounter sat at
 * `awaiting_triage` rendered an "Awaiting triage" status chip (read from the
 * encounter) while filing under the Upcoming lane (read from the appointment,
 * still `scheduled`) — In Facility showed zero with a patient in the building.
 * The encounter-derived lane must win whenever there is one, because it is the
 * same source the row's chip displays.
 */
import { computeRowStatusGroup } from '@/components/ehr/EhrClinicalDashboard';

describe('computeRowStatusGroup', () => {
  it('files an encounter-backed row by the encounter lane, not the appointment status', () => {
    // Appointment never flipped past `scheduled`, but the visit is open.
    expect(computeRowStatusGroup('scheduled', false, 'in_facility')).toBe('in_office');
    // A closed encounter overrides a stale open appointment status too.
    expect(computeRowStatusGroup('checked_in', true, 'finished')).toBe('finished');
    // An encounter still upstream of arrival stays in Upcoming.
    expect(computeRowStatusGroup('scheduled', false, 'upcoming')).toBe('scheduled');
  });

  it('keeps the queue-entry promotion when there is no encounter', () => {
    expect(computeRowStatusGroup('scheduled', true)).toBe('in_office');
    expect(computeRowStatusGroup('scheduled', true, null)).toBe('in_office');
    expect(computeRowStatusGroup('scheduled', false)).toBe('scheduled');
  });

  it('keeps appointment-status grouping when there is no encounter and no queue entry', () => {
    expect(computeRowStatusGroup('checked_in', false)).toBe('in_office');
    expect(computeRowStatusGroup('in_progress', false)).toBe('in_office');
    expect(computeRowStatusGroup('completed', false)).toBe('finished');
    expect(computeRowStatusGroup('cancelled', false)).toBe('finished');
    // `arrived` deliberately stays Upcoming until the desk opens the visit.
    expect(computeRowStatusGroup('arrived', false)).toBe('scheduled');
  });
});
