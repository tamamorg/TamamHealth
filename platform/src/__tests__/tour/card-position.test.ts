/**
 * Tour card placement.
 *
 * The regression these cover: a step whose target is taller than the window.
 * `.gov-map-panel` on the national dashboard is `grid-row: 1 / -1`, so it runs
 * past the top and bottom of the viewport at once — neither side of it "fits",
 * and the card used to be placed at `rect.bottom + GAP`, i.e. below the fold.
 * The spotlight rendered, the card did not, and with Next unreachable the
 * government journey could never leave step one.
 */
import { cardPosition } from '@/components/tour/TourCard';

const MARGIN = 12;
const CARD_WIDTH = 300;

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width,
    bottom: top + height,
    x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

/** Every coordinate the card can be given must leave it fully on screen. */
function expectOnScreen(style: React.CSSProperties, cardH: number) {
  const left = style.left as number;
  const top = style.top as number;
  expect(left).toBeGreaterThanOrEqual(MARGIN);
  expect(top).toBeGreaterThanOrEqual(MARGIN);
  expect(left + CARD_WIDTH).toBeLessThanOrEqual(window.innerWidth - MARGIN);
  expect(top + cardH).toBeLessThanOrEqual(window.innerHeight - MARGIN);
}

describe('cardPosition', () => {
  beforeEach(() => setViewport(1440, 900));

  it('keeps the card on screen when the target is taller than the viewport', () => {
    // The national dashboard map panel: starts just under the header and runs
    // well past the bottom of the window.
    const { style, tail } = cardPosition(rectOf(24, 60, 1000, 1400), 'bottom', 260);
    expectOnScreen(style, 260);
    // Nothing to point at once the clamp has moved the card off the anchor.
    expect(tail).toBeNull();
  });

  it('still sits directly below a short target, with its tail', () => {
    const { style, tail } = cardPosition(rectOf(400, 100, 500, 200), 'bottom', 260);
    expect(style.top).toBe(300 + 14);
    expect(tail).toBe('top');
    expectOnScreen(style, 260);
  });

  it('flips a bottom-placed step above the target when only that side fits', () => {
    const { style, tail } = cardPosition(rectOf(400, 500, 500, 380), 'bottom', 200);
    expect(style.top).toBe(500 - 14 - 200);
    expect(tail).toBe('bottom');
    expectOnScreen(style, 200);
  });

  it('clamps horizontally when neither side has room for a left/right step', () => {
    setViewport(700, 900);
    const { style, tail } = cardPosition(rectOf(120, 300, 460, 200), 'right', 260);
    expectOnScreen(style, 260);
    expect(tail).toBeNull();
  });

  it('keeps a top-placed step on screen when the target overflows upward', () => {
    const { style, tail } = cardPosition(rectOf(24, -600, 1000, 1400), 'top', 260);
    expectOnScreen(style, 260);
    expect(tail).toBeNull();
  });
});
