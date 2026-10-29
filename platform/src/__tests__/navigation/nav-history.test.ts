import { observeLocation, canGoBackInApp, __resetNavHistory } from '@/lib/navigation/nav-history';

beforeEach(() => { __resetNavHistory(); window.history.replaceState(null, '', '/dashboard'); });

describe('nav history — Back means the previous screen', () => {
  it('the first page seen has nothing in-app behind it', () => {
    observeLocation();
    expect(canGoBackInApp()).toBe(false);
    expect((window.history.state as { tmIdx: number }).tmIdx).toBe(0);
  });

  it('a pushed page has the previous page behind it', () => {
    observeLocation();
    window.history.pushState(null, '', '/patients/p1');
    observeLocation();
    expect(canGoBackInApp()).toBe(true);
    expect((window.history.state as { tmIdx: number }).tmIdx).toBe(1);
  });

  it('a replaced URL is not counted as a page to go back to', () => {
    observeLocation();
    window.history.replaceState(null, '', '/dashboard?lane=in_office');
    observeLocation();
    expect(canGoBackInApp()).toBe(false);
  });

  it('popping back restores the index from the entry', () => {
    observeLocation();
    window.history.pushState(null, '', '/patients/p1');
    observeLocation();
    const first = { tmIdx: 0 };
    window.dispatchEvent(new PopStateEvent('popstate', { state: first }));
    expect(canGoBackInApp()).toBe(false);
  });
});
