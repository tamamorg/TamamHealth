import { observeLocation, canGoBackInApp, __resetNavHistory } from '@/lib/navigation/nav-history';

beforeEach(() => { __resetNavHistory(); window.history.replaceState({ tmIdx: 0 }, '', '/dashboard'); observeLocation(); });

const idx = () => (window.history.state as { tmIdx: number }).tmIdx;

describe('nav history — Back means the previous screen', () => {
  it('the first page has nothing in-app behind it', () => {
    expect(canGoBackInApp()).toBe(false);
    expect(idx()).toBe(0);
  });

  it('a pushed page has the previous page behind it', () => {
    window.history.pushState({ __NA: true }, '', '/patients/p1');
    expect(canGoBackInApp()).toBe(true);
    expect(idx()).toBe(1);
    expect((window.history.state as { __NA: boolean }).__NA).toBe(true);
  });

  it('a replaced URL is not counted as a page to go back to', () => {
    window.history.replaceState({ __NA: true }, '', '/dashboard?lane=in_office');
    expect(canGoBackInApp()).toBe(false);
    expect(idx()).toBe(0);
  });

  it('an overlay entry keeps the page index (a dialog is not a page)', () => {
    window.history.pushState({ ...window.history.state, tmLayer: 'layer-1' }, '');
    expect(canGoBackInApp()).toBe(false);
  });

  it('after an overlay is closed, the next page still counts (the old bug)', () => {
    window.history.pushState({ ...window.history.state, tmLayer: 'layer-1' }, '');
    // the overlay closes: history steps back onto the page entry
    window.dispatchEvent(new PopStateEvent('popstate', { state: { tmIdx: 0 } }));
    window.history.pushState({ __NA: true }, '', '/patients/p1');
    expect(canGoBackInApp()).toBe(true);
  });

  it('popping back restores the index from the entry', () => {
    window.history.pushState({}, '', '/patients/p1');
    window.dispatchEvent(new PopStateEvent('popstate', { state: { tmIdx: 0 } }));
    expect(canGoBackInApp()).toBe(false);
  });
});
