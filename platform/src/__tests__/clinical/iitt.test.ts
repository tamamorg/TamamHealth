import {
  filterKnownIittCodes,
  highestTriagePriority,
  IITT_RED_CRITERIA,
  priorityFromIittCriteria,
} from '@/lib/clinical/iitt';

describe('IITT structured assessment', () => {
  test('unknown or duplicate client codes cannot enter the clinical record', () => {
    expect(filterKnownIittCodes(
      ['shock_bleeding', 'invented_sign', 'shock_bleeding'],
      IITT_RED_CRITERIA,
    )).toEqual(['shock_bleeding']);
  });

  test('a prolonged capillary refill independently recommends RED', () => {
    expect(priorityFromIittCriteria([], [], 4)).toBe('RED');
    expect(priorityFromIittCriteria([], [], 3)).toBeUndefined();
  });

  test('the most urgent recommendation always wins', () => {
    expect(highestTriagePriority('YELLOW', 'RED')).toBe('RED');
    expect(highestTriagePriority(undefined, 'GREEN')).toBe('GREEN');
  });
});
