import { isDuplicateHandoff } from '@/lib/handoff-rules';

const signed = { outgoingNurseId: 'u1', shiftDate: '2026-11-08', shift: 'night' as const, status: 'signed' as const };

describe('isDuplicateHandoff', () => {
  it('blocks a second sign-off for the same nurse, date and shift', () => {
    expect(isDuplicateHandoff(signed, 'u1', '2026-11-08', 'night')).toBe(true);
  });
  it('lets the same nurse sign the next shift on the same date', () => {
    expect(isDuplicateHandoff(signed, 'u1', '2026-11-08', 'day')).toBe(false);
  });
  it('ignores other nurses, other dates, acknowledged handoffs and none at all', () => {
    expect(isDuplicateHandoff(signed, 'u2', '2026-11-08', 'night')).toBe(false);
    expect(isDuplicateHandoff(signed, 'u1', '2026-11-09', 'night')).toBe(false);
    expect(isDuplicateHandoff({ ...signed, status: 'acknowledged' }, 'u1', '2026-11-08', 'night')).toBe(false);
    expect(isDuplicateHandoff(null, 'u1', '2026-11-08', 'night')).toBe(false);
  });
});
