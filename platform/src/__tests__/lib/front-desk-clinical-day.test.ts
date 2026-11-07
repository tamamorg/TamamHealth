import fs from 'fs';
import path from 'path';
import { isoDateKey } from '@/lib/front-desk-utils';
import { jubaDate } from '@/lib/time-juba';

describe('desk clinical day', () => {
  it('dates a timestamp on the Juba day, not the UTC prefix', () => {
    // 23:30 UTC on Nov 5 is already 01:30 on Nov 6 in Juba (UTC+2).
    expect(isoDateKey('2026-11-05T23:30:00.000Z')).toBe('2026-11-06');
    expect(isoDateKey('2026-11-05T10:00:00.000Z')).toBe('2026-11-05');
  });
  it('passes a bare date through and agrees with jubaDate', () => {
    expect(isoDateKey('2026-11-06')).toBe('2026-11-06');
    expect(isoDateKey('2026-11-05T23:30:00.000Z')).toBe(jubaDate(new Date('2026-11-05T23:30:00.000Z')));
  });
});

describe('desk Completed always runs the checkout gate', () => {
  const board = (file: string) => fs.readFileSync(
    path.join(__dirname, '../../components/front-desk/desk-board', file), 'utf8');
  // Row rules hold the row builder; the board-state hook holds the clinical day.
  const src = [board('desk-row-rules.tsx'), board('useDeskBoardState.ts')].join('\n');
  it('routes a booking-less queue row to CheckoutModal, and never writes completed bare', () => {
    expect(src).toMatch(/else if \(next === 'completed'\)[\s\S]{0,600}setCheckoutTarget/);
    expect(src).not.toMatch(/if \(status === 'completed'\) patch\.status = 'discharged'/);
    expect(src).toMatch(/const today = jubaDate\(\)/);
  });
});
