/** The chart's section list can always be dragged back to where it started. */
import { dragRailWidth, settleRailWidth } from '@/components/ehr/chart/RailResizeHandle';

describe('chart section list width', () => {
  it('follows the pointer out from icons, with no dead zone', () => {
    expect(dragRailWidth(80)).toBe(80);
    expect(dragRailWidth(120)).toBe(120);
  });

  it('stops at the icon column and the maximum', () => {
    expect(dragRailWidth(10)).toBe(56);
    expect(dragRailWidth(900)).toBe(360);
  });

  it('holds at the default position when dragged near it', () => {
    expect(dragRailWidth(228)).toBe(240);
    expect(dragRailWidth(252)).toBe(240);
  });

  it('returns to the default, remembering nothing, when released near it', () => {
    expect(settleRailWidth(240)).toBeNull();
    expect(settleRailWidth(226)).toBeNull();
    expect(settleRailWidth(254)).toBeNull();
  });

  it('settles as icons when released too narrow for labels', () => {
    expect(settleRailWidth(149)).toBe(56);
  });

  it('keeps a width chosen away from the default', () => {
    expect(settleRailWidth(200)).toBe(200);
    expect(settleRailWidth(300)).toBe(300);
  });
});
