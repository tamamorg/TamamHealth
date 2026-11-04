/**
 * Right-hand panels stack newest on top: a chart workspace opened over a
 * slider puts that slider aside until it closes; a slider opened over the
 * workspace sits on top of it.
 */
import {
  closeDrawerLayer, closeSliderLayer, isSliderBuried, openSliderLayer, raiseDrawerLayer, reserveOverlayOrder, subscribeOverlayOrder,
} from '@/lib/overlay-order';

afterEach(() => closeDrawerLayer());

describe('overlay order', () => {
  it('puts an older slider under a newer workspace, and brings it back when that closes', () => {
    const slider = reserveOverlayOrder();
    openSliderLayer(slider);
    expect(isSliderBuried(slider)).toBe(false);

    raiseDrawerLayer();
    expect(isSliderBuried(slider)).toBe(true);
    expect(document.documentElement.classList.contains('tm-drawer-over')).toBe(true);

    closeDrawerLayer();
    expect(isSliderBuried(slider)).toBe(false);
    expect(document.documentElement.classList.contains('tm-drawer-over')).toBe(false);
    closeSliderLayer(slider);
  });

  it('keeps a slider opened over the workspace on top of it', () => {
    raiseDrawerLayer();
    const slider = reserveOverlayOrder();
    openSliderLayer(slider);
    expect(isSliderBuried(slider)).toBe(false);
    expect(document.documentElement.classList.contains('tm-drawer-over')).toBe(false);
    closeSliderLayer(slider);
  });

  it('tells subscribers when the order changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeOverlayOrder(listener);
    raiseDrawerLayer();
    closeDrawerLayer();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('never puts a question (a pinned confirm) aside under a newer workspace', () => {
    const question = reserveOverlayOrder();
    openSliderLayer(question, true);
    raiseDrawerLayer();
    expect(isSliderBuried(question)).toBe(false);
    closeSliderLayer(question);
  });
});
