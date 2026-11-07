/**
 * The top-rail module badges (lib/module-badges.ts).
 *
 * 2026-11-07: the lab icon carried a number while its queue was empty, because
 * it counted result notifications (ready, critical, overdue review). It now
 * counts new requests only.
 */
import { moduleBadgeCounts } from '@/lib/module-badges';
import type { NotificationItem } from '@/modules/communication';

const item = (type: NotificationItem['type'], id: string): NotificationItem => ({
  id, type, severity: 'info', title: 'Patient', subtitle: '', time: '2026-11-07T08:00:00Z', href: '/lab',
} as NotificationItem);

describe('lab badge', () => {
  it('counts new lab requests', () => {
    expect(moduleBadgeCounts([item('lab_request', 'a'), item('lab_request', 'b')])['/lab']).toBe(2);
  });

  it('ignores result notifications, so a queue with nothing new shows no badge', () => {
    const counts = moduleBadgeCounts([item('lab', 'ready-1'), item('lab', 'critical-1'), item('lab', 'overdue-1')]);
    expect(counts['/lab']).toBeUndefined();
  });
});
