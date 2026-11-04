/**
 * Closing the chart returns to the page it was opened from, past slider
 * layers and the chart's own tab entries (which share its pathname).
 */
import { __resetNavHistory, observeLocation, originBefore } from '@/lib/navigation/nav-history';

const go = (url: string, layer = false) => {
  window.history.pushState(layer ? { tmLayer: 'l1' } : {}, '', url);
  observeLocation();
};

beforeEach(() => {
  __resetNavHistory();
  window.sessionStorage.clear();
  window.history.replaceState({ tmIdx: 0 }, '', '/dashboard');
  observeLocation();
});

it('skips the chart\'s own tabs and open layers to reach the page it came from', () => {
  go('/appointments?view=today');
  go('/patients/p1');
  go('/patients/p1?tab=medications');
  go('/patients/p1?tab=medications', true);
  expect(originBefore('/patients/p1')).toBe('/appointments?view=today');
});

it('has no origin when the chart was the first page of the tab', () => {
  window.history.replaceState({ tmIdx: 0 }, '', '/patients/p1');
  observeLocation();
  expect(originBefore('/patients/p1')).toBeNull();
});
