/**
 * The state list the analytics roll-ups loop over (SOUTH_SUDAN_STATES) must
 * cover every administrative area a patient can actually be registered under
 * (the registration gazetteer's `states`). They had drifted: registration
 * offered 11, the analytics constant listed 10 — so Abyei Region patients fell
 * out of every mch-analytics / epidemic-intelligence state total
 * (security/data audit 2026-11-05, §2.1 #16).
 */
import { SOUTH_SUDAN_STATES } from '@/lib/geographic-data';
import { states as registrationStates } from '@/lib/data/south-sudan-reference';

describe('analytics state coverage', () => {
  it('SOUTH_SUDAN_STATES covers every state registration offers', () => {
    const missing = registrationStates.filter(s => !SOUTH_SUDAN_STATES.includes(s));
    expect(missing).toEqual([]);
  });

  it('includes Abyei Region', () => {
    expect(SOUTH_SUDAN_STATES).toContain('Abyei Region');
  });
});
