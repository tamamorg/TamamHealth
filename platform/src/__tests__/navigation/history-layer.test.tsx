import React from 'react';
import { act } from 'react';
import { mount } from '../components/clinical-notes/test-utils';

const render = (ui: React.ReactElement) => { const m = mount(ui); return { unmount: () => act(() => m.root.unmount()) }; };
import { useHistoryLayer, __resetHistoryLayers } from '@/lib/navigation/history-layer';

function Layer({ onBack }: { onBack: () => void }) {
  useHistoryLayer(true, onBack);
  return null;
}

beforeEach(() => { jest.useFakeTimers(); window.history.replaceState(null, '', '/patients/p1'); __resetHistoryLayers(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

type S = { tmLayer?: string; tmBase?: string; tmSpent?: string; tmSeq?: number } | null;
const state = () => window.history.state as S;

/** Simulate the browser landing on `entry` (its URL stays the page URL). */
const pop = (entry: unknown) => {
  window.history.replaceState(entry, '');
  window.dispatchEvent(new PopStateEvent('popstate', { state: entry }));
};

describe('useHistoryLayer — Back closes the top layer', () => {
  it('pushes one entry a tick after opening, on the same URL', () => {
    const before = window.history.length;
    render(<Layer onBack={jest.fn()} />);
    expect(window.history.length).toBe(before);
    act(() => { jest.advanceTimersByTime(1); });
    expect(window.history.length).toBe(before + 1);
    expect(window.location.pathname).toBe('/patients/p1');
    expect(state()?.tmLayer).toMatch(/^layer-/);
  });

  it('Back closes only the top of two stacked layers', () => {
    const lower = jest.fn();
    const upper = jest.fn();
    render(<Layer onBack={lower} />);
    act(() => { jest.advanceTimersByTime(1); });
    const lowerEntry = { ...state() };
    render(<Layer onBack={upper} />);
    act(() => { jest.advanceTimersByTime(1); });
    act(() => { pop(lowerEntry); });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    act(() => { pop(null); });
    expect(lower).toHaveBeenCalledTimes(1);
  });

  it('a throwaway mount (dev double-mount) never touches history', () => {
    const before = window.history.length;
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    unmount();
    act(() => { jest.advanceTimersByTime(500); });
    expect(window.history.length).toBe(before);
  });
});

describe('closing by its own controls never steps history', () => {
  it('marks the entry spent instead of popping it (a navigation may follow)', () => {
    const go = jest.spyOn(window.history, 'go').mockImplementation(() => {});
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    const token = state()?.tmLayer;
    unmount();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(go).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(state()?.tmSpent).toBe(token);
    expect(state()?.tmLayer).toBeUndefined();
  });

  it('keeps other keys on the entry (the app router and page index)', () => {
    window.history.replaceState({ __NA: true, tmIdx: 4 }, '');
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    expect(state()).toMatchObject({ __NA: true, tmIdx: 4 });
    unmount();
    expect(state()).toMatchObject({ __NA: true, tmIdx: 4 });
  });

  it('Back after a close still leaves the page in one press', () => {
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    unmount();
    // Back from the spent entry lands on the page's own entry beneath it…
    const base = { tmBase: (state() as { tmSpent: string }).tmSpent, tmSeq: 1 };
    act(() => { pop(base); });
    // …which is the same page, so the hook steps once more.
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('several layers closing at once are all stepped over', () => {
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
    const a = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    const lowerEntry = { ...state() };
    const b = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    b.unmount(); a.unmount();
    // The lower layer's entry was not current, so it keeps tmLayer — but its
    // layer is closed, so it is spent too.
    act(() => { pop(lowerEntry); });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('returning from another page stops at the page, past its spent entry', () => {
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    const spentEntry = { ...state() };
    const baseToken = (spentEntry as { tmLayer: string }).tmLayer;
    unmount();
    // The app navigates on (the slip → check-in)…
    window.history.pushState({}, '', '/appointments');
    // …and Back comes home: over the spent entry (one step)…
    window.history.replaceState(null, '', '/patients/p1');
    window.dispatchEvent(new PopStateEvent('popstate', { state: { tmSpent: baseToken, tmSeq: 2 } }));
    expect(back).toHaveBeenCalledTimes(1);
    // …and stops at the page itself.
    window.dispatchEvent(new PopStateEvent('popstate', { state: { tmBase: baseToken, tmSeq: 1 } }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('Forward over a spent entry keeps going forward', () => {
    const forward = jest.spyOn(window.history, 'forward').mockImplementation(() => {});
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    const token = state()?.tmLayer as string;
    unmount();
    // On the page entry (seq 1), Forward lands on the spent one (seq 2).
    act(() => { pop({ tmBase: token, tmSeq: 1 }); });
    back.mockClear();
    act(() => { pop({ tmSpent: token, tmSeq: 2 }); });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});
