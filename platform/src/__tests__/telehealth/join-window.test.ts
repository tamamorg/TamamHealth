/**
 * @jest-environment node
 *
 * The telehealth join window — who may open a visit, and when.
 *
 * This is an access decision, not a nicety: `/api/telehealth/token` refuses to
 * mint LiveKit credentials outside the window, so these boundaries are what
 * stand between a patient and a consultation room. It had no test coverage at
 * all — the one telehealth suite covers encounter linkage.
 *
 * `now` is passed in, so nothing here depends on the wall clock.
 */

import {
  evaluateJoinWindow,
  parseScheduledInstant,
  DEFAULT_JOIN_WINDOW,
} from '@/lib/telehealth-join-window';

/** A local-wall-clock instant, matching how the parser builds its Dates. */
const at = (iso: string) => new Date(iso);
const session = (scheduledDate?: string, scheduledTime?: string) => ({ scheduledDate, scheduledTime });

describe('parsing the scheduled instant', () => {
  test('a well-formed date and time parse to that wall clock', () => {
    const parsed = parseScheduledInstant('2026-08-20', '14:30');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(7); // August, zero-indexed
    expect(parsed!.getDate()).toBe(20);
    expect(parsed!.getHours()).toBe(14);
    expect(parsed!.getMinutes()).toBe(30);
  });

  test.each([
    ['missing date', undefined, '14:30'],
    ['missing time', '2026-08-20', undefined],
    ['malformed date', '20-08-2026', '14:30'],
    ['malformed time', '2026-08-20', '2.30pm'],
    ['empty strings', '', ''],
  ])('%s yields null rather than an Invalid Date', (_label, date, time) => {
    // The distinction matters: an Invalid Date compares false against every
    // bound, so a NaN would silently read as "outside the window" everywhere
    // instead of taking the one explicit unscheduled path.
    expect(parseScheduledInstant(date, time)).toBeNull();
  });
});

describe('the join window', () => {
  const SCHEDULED = session('2026-08-20', '14:00');

  test('opens 15 minutes before the appointment', () => {
    expect(evaluateJoinWindow(SCHEDULED, DEFAULT_JOIN_WINDOW, at('2026-08-20T13:44:59')).open).toBe(false);
    expect(evaluateJoinWindow(SCHEDULED, DEFAULT_JOIN_WINDOW, at('2026-08-20T13:45:00')).open).toBe(true);
  });

  test('closes 30 minutes after it', () => {
    expect(evaluateJoinWindow(SCHEDULED, DEFAULT_JOIN_WINDOW, at('2026-08-20T14:30:00')).open).toBe(true);
    expect(evaluateJoinWindow(SCHEDULED, DEFAULT_JOIN_WINDOW, at('2026-08-20T14:30:01')).open).toBe(false);
  });

  test('an early arrival is told when to come back, not just refused', () => {
    const state = evaluateJoinWindow(SCHEDULED, DEFAULT_JOIN_WINDOW, at('2026-08-20T12:00:00'));
    expect(state.reason).toBe('too_early');
    expect(state.message).toContain('13:45');
  });

  test('a late arrival is told what to do next', () => {
    // "Window closed" alone leaves a patient who is ten minutes late with no
    // idea whether care is still coming.
    const state = evaluateJoinWindow(SCHEDULED, DEFAULT_JOIN_WINDOW, at('2026-08-20T16:00:00'));
    expect(state.reason).toBe('too_late');
    expect(state.message).toMatch(/rebook|contact your clinic/i);
  });

  test('an unscheduled visit is joinable — it has no slot to be late for', () => {
    // The clinician-initiated walk-in is the common path today; refusing it
    // would break the flow this feature is mostly used for.
    const state = evaluateJoinWindow(session(), DEFAULT_JOIN_WINDOW, at('2026-08-20T03:00:00'));
    expect(state.open).toBe(true);
    expect(state.reason).toBe('unscheduled');
    expect(state.scheduledAt).toBeNull();
  });

  test('a facility can widen or narrow its own window', () => {
    const wide = { beforeMinutes: 120, afterMinutes: 120 };
    expect(evaluateJoinWindow(SCHEDULED, wide, at('2026-08-20T12:30:00')).open).toBe(true);
    const narrow = { beforeMinutes: 0, afterMinutes: 0 };
    expect(evaluateJoinWindow(SCHEDULED, narrow, at('2026-08-20T14:00:00')).open).toBe(true);
    expect(evaluateJoinWindow(SCHEDULED, narrow, at('2026-08-20T14:00:01')).open).toBe(false);
  });

  test('a negative configured window is clamped, not inverted', () => {
    // A misconfigured -30 must not produce a window that closes before it
    // opens, which would lock every patient out with a confusing message.
    const state = evaluateJoinWindow(SCHEDULED, { beforeMinutes: -30, afterMinutes: -30 }, at('2026-08-20T14:00:00'));
    expect(state.opensAt!.getTime()).toBeLessThanOrEqual(state.closesAt!.getTime());
    expect(state.open).toBe(true);
  });
});
