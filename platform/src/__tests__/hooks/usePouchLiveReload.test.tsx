import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePouchLiveReload } from '@/lib/hooks/usePouchLiveReload';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Doc = { _id: string };
type Change = { doc?: Doc; deleted?: boolean };

function createFeed() {
  let changeListener: (change: Change) => void = () => undefined;
  const feed = {
    on(event: 'change' | 'error', listener: ((change: Change) => void) | (() => void)) {
      if (event === 'change') changeListener = listener as (change: Change) => void;
      return feed;
    },
    cancel: jest.fn(),
    emit(change: Change) { changeListener(change); },
  };
  return feed;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  jest.useRealTimers();
});

it('loads once, filters changes, coalesces bursts, and cancels its feed', () => {
  const feed = createFeed();
  const load = jest.fn();
  const database = () => ({
    changes: jest.fn(() => feed),
  });

  function Harness() {
    usePouchLiveReload<Doc>({
      load,
      database,
      includeDocs: true,
      shouldReload: change => change.doc?._id === 'wanted',
    });
    return null;
  }

  act(() => root.render(<Harness />));
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    feed.emit({ doc: { _id: 'ignored' } });
    feed.emit({ doc: { _id: 'wanted' } });
    feed.emit({ doc: { _id: 'wanted' } });
  });
  expect(load).toHaveBeenCalledTimes(2);

  act(() => jest.advanceTimersByTime(300));
  expect(load).toHaveBeenCalledTimes(3);

  act(() => root.unmount());
  expect(feed.cancel).toHaveBeenCalledTimes(1);
});
