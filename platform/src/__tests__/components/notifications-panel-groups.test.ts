/** What the bell panel shows, and in what order. */
import { groupForPanel } from '@/components/NotificationsPanel';

// Midday, so "a few hours ago" is still today whenever this runs.
beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date(2026, 9, 15, 12)); });
afterAll(() => { jest.useRealTimers(); });

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

describe('notification panel groups', () => {
  it('keeps days in order, newest first within each', () => {
    const groups = groupForPanel([
      { id: 'old', time: hoursAgo(24 * 30) },
      { id: 'a', time: hoursAgo(0.2), read: true },
      { id: 'b', time: hoursAgo(0.1) },
    ]);
    expect(groups.map(g => g.bucket)).toEqual(['today', 'older']);
    expect(groups[0].items.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('keeps unread ones when there are more than fit', () => {
    const read = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, time: hoursAgo(0.01), read: true }));
    const unread = { id: 'unread', time: hoursAgo(24 * 30) };
    const shown = groupForPanel([...read, unread]).flatMap(g => g.items);
    expect(shown).toHaveLength(40);
    expect(shown.some(i => i.id === 'unread')).toBe(true);
  });

  it('shows nothing when there is nothing', () => {
    expect(groupForPanel([])).toEqual([]);
  });
});
