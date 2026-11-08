/**
 * Lane filing for the clinical dashboard worklist (computeRowStatusGroup).
 * The rule itself lives in visit-display-status.ts (see
 * visit-display-status.test.ts for the full spec table); this guards the
 * worklist wrapper: the encounter wins, and only a provider taking the
 * patient (`inService`) lifts a queued row out of Waiting.
 */
import { computeRowStatusGroup } from '@/components/ehr/clinical-dashboard/worklist-rules';

describe('computeRowStatusGroup', () => {
  it('files an encounter-backed row by the encounter stage, not the appointment status', () => {
    expect(computeRowStatusGroup('scheduled', false, 'in_triage')).toBe('in_office');
    expect(computeRowStatusGroup('checked_in', false, 'discharged')).toBe('finished');
    // Awaiting triage is still the queue.
    expect(computeRowStatusGroup('scheduled', false, 'awaiting_triage')).toBe('scheduled');
  });

  it('keeps a checked-in or arrived patient in Waiting', () => {
    expect(computeRowStatusGroup('checked_in', false)).toBe('scheduled');
    expect(computeRowStatusGroup('arrived', false)).toBe('scheduled');
    expect(computeRowStatusGroup('scheduled', false)).toBe('scheduled');
  });

  it('moves a queued row to In service once a provider has taken the patient', () => {
    expect(computeRowStatusGroup('checked_in', true)).toBe('in_office');
    expect(computeRowStatusGroup('scheduled', true, null)).toBe('in_office');
  });

  it('files by appointment status when there is no encounter', () => {
    expect(computeRowStatusGroup('in_progress', false)).toBe('in_office');
    expect(computeRowStatusGroup('completed', false)).toBe('finished');
    expect(computeRowStatusGroup('cancelled', false)).toBe('finished');
  });
});
