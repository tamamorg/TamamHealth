/**
 * The owner's spec (2026-11-07) for visit tabs and colours, one assertion per
 * row. Waiting until a provider/clinical team member begins care; colour by
 * meaning: slate idle, blue queue action, purple active, green done, red
 * cancelled / no-show.
 */
import { resolveVisitDisplay, ENCOUNTER_DISPLAY, APPOINTMENT_DISPLAY } from '@/lib/visit-display-status';
import { appointmentStatusGroup, APPOINTMENT_STATUS_TONES } from '@/lib/appointment-status';
import { ENCOUNTER_TRANSITIONS } from '@/lib/clinical-flow/encounter-journey';
import type { AppointmentStatus } from '@/lib/db-types';
import type { EncounterStatus } from '@/lib/clinical-flow/encounter-journey';

const W = 'scheduled', S = 'in_office', F = 'finished';

type Row = [string, { a?: AppointmentStatus; e?: EncounterStatus; nursing?: boolean; inService?: boolean }, string, string];

const SPEC: Row[] = [
  // Waiting
  ['Scheduled', { a: 'scheduled' }, W, 'slate'],
  ['Scheduled (confirmed)', { a: 'confirmed' }, W, 'slate'],
  ['Arrived', { a: 'arrived' }, W, 'blue'],
  ['Checked In', { a: 'checked_in' }, W, 'blue'],
  ['Arrived at facility', { e: 'arrived_at_facility' }, W, 'blue'],
  ['Ready for Triage', { e: 'awaiting_triage' }, W, 'blue'],
  ['Awaiting rooming', { e: 'arrived_at_clinic_awaiting_rooming' }, W, 'blue'],
  // In service
  ['In Triage', { e: 'in_triage' }, S, 'purple'],
  ['Triage Complete (appointment)', { a: 'triaged' }, S, 'blue'],
  ['Triage Complete (encounter)', { e: 'triaged_awaiting_destination' }, S, 'blue'],
  ['Roomed / Ready for Provider', { e: 'ready_for_clinician' }, S, 'blue'],
  ['In rooming', { e: 'in_rooming' }, S, 'purple'],
  ['With Provider (encounter)', { e: 'with_clinician' }, S, 'purple'],
  ['With Provider (appointment)', { a: 'in_progress' }, S, 'purple'],
  ['Provider has taken a queued patient', { a: 'checked_in', inService: true }, S, 'purple'],
  ['Nursing review still open after sign', { e: 'ready_for_clinic_checkout', nursing: true }, S, 'purple'],
  // Finished
  ['Ready for Discharge', { e: 'ready_for_clinic_checkout' }, F, 'blue'],
  ['Facility checkout', { e: 'awaiting_facility_checkout' }, F, 'blue'],
  ['Discharged', { e: 'discharged' }, F, 'green'],
  ['Completed', { a: 'completed' }, F, 'green'],
  ['Canceled', { a: 'cancelled' }, F, 'red'],
  ['No Show', { a: 'no_show' }, F, 'red'],
  ['Rescheduled', { a: 'rescheduled' }, F, 'red'],
];

describe('resolveVisitDisplay: the owner spec', () => {
  it.each(SPEC)('%s', (_name, input, tab, tone) => {
    const d = resolveVisitDisplay({
      appointmentStatus: input.a, encounterStatus: input.e,
      nursingReviewOpen: input.nursing, inService: input.inService,
    });
    expect({ tab: d.tab, tone: d.tone }).toEqual({ tab, tone });
  });

  it('a closed visit is never pulled back by inService', () => {
    expect(resolveVisitDisplay({ appointmentStatus: 'completed', inService: true }).tab).toBe(F);
  });

  it('the encounter wins over a stale appointment status', () => {
    expect(resolveVisitDisplay({ appointmentStatus: 'scheduled', encounterStatus: 'with_clinician' }).tab).toBe(S);
  });

  it('covers every stored appointment status and encounter stage', () => {
    const encounterStages = Object.keys(ENCOUNTER_TRANSITIONS) as EncounterStatus[];
    for (const stage of encounterStages) expect(ENCOUNTER_DISPLAY[stage]).toBeDefined();
    for (const status of ['requested', 'scheduled', 'reminder_sent', 'confirmed', 'arrived', 'checked_in', 'triaged', 'in_progress', 'completed', 'no_show', 'rescheduled', 'cancelled'] as AppointmentStatus[]) {
      expect(APPOINTMENT_DISPLAY[status]).toBeDefined();
    }
  });

  it('the legacy appointment tables derive from the same mapping', () => {
    expect(appointmentStatusGroup('checked_in')).toBe(W);
    expect(appointmentStatusGroup('arrived')).toBe(W);
    expect(appointmentStatusGroup('in_progress')).toBe(S);
    expect(APPOINTMENT_STATUS_TONES.checked_in).toBe('ready');
    expect(APPOINTMENT_STATUS_TONES.in_progress).toBe('active');
    expect(APPOINTMENT_STATUS_TONES.scheduled).toBe('scheduled');
    expect(APPOINTMENT_STATUS_TONES.completed).toBe('done');
    expect(APPOINTMENT_STATUS_TONES.cancelled).toBe('danger');
  });
});
