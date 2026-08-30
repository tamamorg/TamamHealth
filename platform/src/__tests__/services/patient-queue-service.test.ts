/**
 * `stageForAppointmentStatus` and `deriveAppointmentWait` back the front
 * desk's wait clock for a CHECKED-IN APPOINTMENT row — the queue-stage
 * vocabulary already existed for triage-sourced rows (`buildQueueFromTriage`)
 * but had zero callers for appointment-sourced ones, so a booked patient the
 * desk checked in showed no wait time and was never flagged for a stale wait
 * (KAN-118). No DB mocking needed — both are pure functions.
 */
import { stageForAppointmentStatus, deriveAppointmentWait, TARGET_WAIT } from '@/lib/services/patient-queue-service';

describe('stageForAppointmentStatus', () => {
  it('maps the pre-clinician ladder onto the same stage vocabulary the triage queue uses', () => {
    expect(stageForAppointmentStatus('arrived')).toBe('awaiting_triage');
    expect(stageForAppointmentStatus('checked_in')).toBe('awaiting_triage');
    expect(stageForAppointmentStatus('triaged')).toBe('awaiting_rooming');
    expect(stageForAppointmentStatus('in_progress')).toBe('awaiting_consultation');
  });

  it('returns null for a visit that is not currently in the building', () => {
    expect(stageForAppointmentStatus('scheduled')).toBeNull();
    expect(stageForAppointmentStatus('completed')).toBeNull();
    expect(stageForAppointmentStatus('cancelled')).toBeNull();
    expect(stageForAppointmentStatus(undefined)).toBeNull();
  });
});

describe('deriveAppointmentWait', () => {
  const MIN = 60_000;

  it('derives minutes waiting from checkedInAt, and flags over-target past 1.5x the stage target', () => {
    const now = Date.parse('2026-08-29T10:00:00.000Z');
    const checkedInAt = new Date(now - 12 * MIN).toISOString();
    // awaiting_triage target is 10 minutes — 12 waited is over target, but not
    // past 1.5x (15 minutes).
    const under = deriveAppointmentWait('checked_in', checkedInAt, now);
    expect(under.waitMinutes).toBe(12);
    expect(under.overTarget).toBe(false);

    const staleCheckedInAt = new Date(now - 20 * MIN).toISOString();
    const over = deriveAppointmentWait('checked_in', staleCheckedInAt, now);
    expect(over.waitMinutes).toBe(20);
    expect(over.overTarget).toBe(true);
    expect(20).toBeGreaterThan(TARGET_WAIT.awaiting_triage * 1.5);
  });

  it('reports no wait for a status with no stage (e.g. completed/scheduled)', () => {
    const now = Date.now();
    expect(deriveAppointmentWait('completed', new Date(now - 999999).toISOString(), now)).toEqual({ overTarget: false });
    expect(deriveAppointmentWait('scheduled', new Date(now - 999999).toISOString(), now)).toEqual({ overTarget: false });
  });

  it('reports no wait when the visit has a stage but was never stamped checked in', () => {
    const now = Date.now();
    expect(deriveAppointmentWait('checked_in', undefined, now)).toEqual({ overTarget: false });
  });
});
