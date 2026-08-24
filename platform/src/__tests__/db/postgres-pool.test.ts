import { postgresPoolMax } from '@/lib/db/postgres';

describe('PostgreSQL pool sizing', () => {
  test('defaults to ten connections per application instance', () => {
    expect(postgresPoolMax(undefined)).toBe(10);
  });

  test('accepts an operator value inside the safe bound', () => {
    expect(postgresPoolMax('24')).toBe(24);
  });

  test.each(['0', '-1', '51', 'not-a-number'])('rejects unsafe value %s', value => {
    expect(postgresPoolMax(value)).toBe(10);
  });
});
