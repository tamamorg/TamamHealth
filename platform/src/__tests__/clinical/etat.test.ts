/**
 * ETAT priority calculator (lib/clinical/etat.ts) — the single implementation
 * now shared by triage-service.ts, components/nurse/shared.tsx, and
 * /api/triage/route.ts.
 *
 * The bug this closes: the API route's own copy had no incompleteness guard,
 * so a POST with no ABCC assessment at all (every dimension falsy) fell
 * through every RED/YELLOW check and returned 'GREEN' — a fabricated finding
 * no clinician made (KAN-100), then persisted once the route defaulted the
 * missing dimensions to 'not_assessed' for storage.
 */
import { calculatePriority } from '@/lib/clinical/etat';

describe('calculatePriority', () => {
  test('an incomplete ABCC returns "" — never a fabricated priority', () => {
    expect(calculatePriority({})).toBe('');
    expect(calculatePriority({ airway: 'clear' })).toBe('');
    expect(calculatePriority({ airway: 'clear', breathing: 'normal' })).toBe('');
    expect(calculatePriority({ airway: 'clear', breathing: 'normal', circulation: 'normal' })).toBe('');
    // This is the exact shape the unguarded route-local copy scored as
    // GREEN: every dimension undefined, as a fresh POST with no ABCC at all.
    expect(calculatePriority({ airway: undefined, breathing: undefined, circulation: undefined, consciousness: undefined })).toBe('');
  });

  test.each<[string, Parameters<typeof calculatePriority>[0]]>([
    ['obstructed airway', { airway: 'obstructed', breathing: 'normal', circulation: 'normal', consciousness: 'alert' }],
    ['absent breathing', { airway: 'clear', breathing: 'absent', circulation: 'normal', consciousness: 'alert' }],
    ['absent circulation', { airway: 'clear', breathing: 'normal', circulation: 'absent', consciousness: 'alert' }],
    ['unresponsive', { airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'unresponsive' }],
  ])('%s is RED', (_label, data) => {
    expect(calculatePriority(data)).toBe('RED');
  });

  test.each<[string, Parameters<typeof calculatePriority>[0]]>([
    ['distressed breathing', { airway: 'clear', breathing: 'distressed', circulation: 'normal', consciousness: 'alert' }],
    ['impaired circulation', { airway: 'clear', breathing: 'normal', circulation: 'impaired', consciousness: 'alert' }],
    ['responds to pain', { airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'pain' }],
    ['responds to voice', { airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'verbal' }],
  ])('%s is YELLOW', (_label, data) => {
    expect(calculatePriority(data)).toBe('YELLOW');
  });

  test('a fully normal ABCC is GREEN', () => {
    expect(calculatePriority({ airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'alert' })).toBe('GREEN');
  });
});

describe('single implementation, not three drifting copies', () => {
  test('triage-service.ts re-exports the exact same function', async () => {
    const { calculatePriority: fromService } = await import('@/lib/services/triage-service');
    expect(fromService).toBe(calculatePriority);
  });
});
