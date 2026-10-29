import React from 'react';
import { act } from 'react';
import { mount } from '../components/clinical-notes/test-utils';

const render = (ui: React.ReactElement) => { const m = mount(ui); return { unmount: () => act(() => m.root.unmount()) }; };
import { useHistoryLayer, __resetHistoryLayers } from '@/lib/navigation/history-layer';

function Layer({ onBack }: { onBack: () => void }) {
  useHistoryLayer(true, onBack);
  return null;
}

beforeEach(() => { __resetHistoryLayers(); jest.useFakeTimers(); window.history.replaceState(null, '', '/patients/p1'); });
afterEach(() => { jest.useRealTimers(); });

const pop = (state: unknown) => {
  window.history.replaceState(state, '');
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
};

describe('useHistoryLayer — Back closes the top layer', () => {
  it('pushes one entry a tick after opening, on the same URL', () => {
    const before = window.history.length;
    render(<Layer onBack={jest.fn()} />);
    expect(window.history.length).toBe(before);
    act(() => { jest.advanceTimersByTime(1); });
    expect(window.history.length).toBe(before + 1);
    expect(window.location.pathname).toBe('/patients/p1');
    expect((window.history.state as { tmLayer?: string }).tmLayer).toMatch(/^layer-/);
  });

  it('Back closes only the top of two stacked layers', () => {
    const lower = jest.fn();
    const upper = jest.fn();
    render(<Layer onBack={lower} />);
    act(() => { jest.advanceTimersByTime(1); });
    const lowerState = window.history.state;
    render(<Layer onBack={upper} />);
    act(() => { jest.advanceTimersByTime(1); });
    act(() => { pop(lowerState); });
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

  it('closing by its own controls removes its entry again', () => {
    const go = jest.spyOn(window.history, 'go').mockImplementation(() => {});
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    unmount();
    act(() => { jest.advanceTimersByTime(300); });
    expect(go).toHaveBeenCalledWith(-1);
    go.mockRestore();
  });

  it('closing several at once removes all their entries in one step', () => {
    const go = jest.spyOn(window.history, 'go').mockImplementation(() => {});
    const a = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    const b = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    b.unmount(); a.unmount();
    act(() => { jest.advanceTimersByTime(300); });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-2);
    go.mockRestore();
  });

  it('never pops under a navigation that moved the user on', () => {
    const back = jest.spyOn(window.history, 'go').mockImplementation(() => {});
    const { unmount } = render(<Layer onBack={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(1); });
    window.history.pushState(null, '', '/patients/p1?tab=notes');
    unmount();
    act(() => { jest.advanceTimersByTime(300); });
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });
});
