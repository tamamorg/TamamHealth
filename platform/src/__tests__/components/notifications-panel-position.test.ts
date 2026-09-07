import { notificationPopoverPosition } from '@/components/NotificationsPanel';

describe('notificationPopoverPosition', () => {
  it('right-aligns the dropdown to the bell on a wide header', () => {
    expect(notificationPopoverPosition(
      { left: 1080, right: 1124, width: 44 },
      1200,
      72,
    )).toEqual({
      left: 704,
      top: 72,
      width: 420,
      pointerLeft: 388,
    });
  });

  it('keeps the dropdown inside a narrow viewport and its pointer near the bell', () => {
    expect(notificationPopoverPosition(
      { left: 236, right: 266, width: 30 },
      309,
      44,
    )).toEqual({
      left: 8,
      top: 44,
      width: 293,
      pointerLeft: 236,
    });
  });
});
