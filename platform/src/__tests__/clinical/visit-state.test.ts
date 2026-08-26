import { appointmentStatusForEncounter, nonRegressingAppointmentStatus, resolveOperationalVisitState } from '@/lib/clinical-flow/visit-state';

describe('operational visit state', () => {
  test.each([
    ['awaiting_triage', 'Awaiting triage'],
    ['in_triage', 'In triage'],
    ['ready_for_clinician', 'Awaiting consultation'],
    ['with_clinician', 'In consultation'],
    ['awaiting_labs', 'Awaiting lab results'],
  ] as const)('%s has a precise shared label', (status, label) => {
    expect(resolveOperationalVisitState({ status: 'checked_in' }, { status }).label).toBe(label);
  });

  test('encounter state overrides a stale coarse appointment status', () => {
    const state = resolveOperationalVisitState({ status: 'checked_in' }, { status: 'with_clinician' });
    expect(state.label).toBe('In consultation');
    expect(state.lane).toBe('in_facility');
  });

  test('encounter stages project back to compatible appointment statuses', () => {
    expect(appointmentStatusForEncounter('in_triage')).toBe('checked_in');
    expect(appointmentStatusForEncounter('triaged_awaiting_destination')).toBe('triaged');
    expect(appointmentStatusForEncounter('with_clinician')).toBe('in_progress');
    expect(appointmentStatusForEncounter('discharged')).toBe('completed');
    expect(appointmentStatusForEncounter('lwbs')).toBe('no_show');
  });

  test('catch-up transitions cannot regress the legacy appointment ladder', () => {
    expect(nonRegressingAppointmentStatus('triaged', 'checked_in')).toBe('triaged');
    expect(nonRegressingAppointmentStatus('in_progress', 'triaged')).toBe('in_progress');
    expect(nonRegressingAppointmentStatus('checked_in', 'in_progress')).toBe('in_progress');
  });
});
