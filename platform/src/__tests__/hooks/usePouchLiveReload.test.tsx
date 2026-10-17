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

it('shares one coalescer across several databases, skips the feed when disabled, and cancels every feed', () => {
  const feedA = createFeed();
  const feedB = createFeed();
  const load = jest.fn();
  const databases = () => [{ changes: jest.fn(() => feedA) }, { changes: jest.fn(() => feedB) }];
  const onError = jest.fn();

  function Harness({ enabled }: { enabled: boolean }) {
    usePouchLiveReload<Doc>({ load, database: databases, enabled, onError });
    return null;
  }

  // Disabled: the mount load still runs but no feed is opened.
  act(() => root.render(<Harness enabled={false} />));
  expect(load).toHaveBeenCalledTimes(1);

  act(() => root.render(<Harness enabled />));
  act(() => {
    feedA.emit({});
    feedB.emit({});
  });
  // Leading edge fires once; the second database's change joins the trailing reload.
  expect(load).toHaveBeenCalledTimes(2);
  act(() => jest.advanceTimersByTime(300));
  expect(load).toHaveBeenCalledTimes(3);

  act(() => root.unmount());
  expect(feedA.cancel).toHaveBeenCalledTimes(1);
  expect(feedB.cancel).toHaveBeenCalledTimes(1);
});

it('skips the mount load when loadOnMount is false', () => {
  const load = jest.fn();
  const feed = createFeed();
  function Harness() {
    usePouchLiveReload<Doc>({ load, database: () => ({ changes: () => feed }), loadOnMount: false });
    return null;
  }
  act(() => root.render(<Harness />));
  expect(load).not.toHaveBeenCalled();
  act(() => feed.emit({}));
  expect(load).toHaveBeenCalledTimes(1);
});
