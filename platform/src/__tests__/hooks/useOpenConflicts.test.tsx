/**
 * The conflicts feed both risk screens read.
 *
 * The bug this guards: `/admin` and `/admin/risk` fetched the pending-conflict
 * count with two separate effects, each of which (a) treated any failure as an
 * empty feed — so a hiccup on a 6,000-row payload made a backlogged platform
 * report itself clean — and (b) guarded stale writes with only a boolean, so a
 * slow superseded response could land last and decide the count. Reload to
 * reload, the same data reported different numbers. This hook is the single,
 * resilient replacement; these tests hold the two guarantees that broke.
 *
 * State is read back through the DOM (like the other hook tests here) rather
 * than captured into a module variable, which keeps the harness render pure.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

jest.mock('@/lib/api-fetch');
import { apiFetch } from '@/lib/api-fetch';
import { useOpenConflicts } from '@/lib/hooks/useOpenConflicts';

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Harness() {
  const state = useOpenConflicts();
  return (
    <>
      <div
        id="state"
        data-status={state.status}
        data-ids={state.conflicts.map(c => (c as { _id: string })._id).join(',')}
      />
      <button id="reload" type="button" onClick={() => state.reload()}>reload</button>
    </>
  );
}

let root: Root;
let container: HTMLDivElement;

function readState() {
  const el = container.querySelector('#state') as HTMLElement;
  return { status: el.dataset.status, ids: el.dataset.ids ? el.dataset.ids.split(',') : [] };
}

// Drain the microtask queue behind the fetch → json → setState chain.
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(() => {
  mockApiFetch.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('reports a loaded feed as ready with its rows', async () => {
  mockApiFetch.mockResolvedValue(response({ conflicts: [{ _id: 'c1' }, { _id: 'c2' }] }));
  await act(async () => { root.render(<Harness />); });
  await flush();
  expect(readState().status).toBe('ready');
  expect(readState().ids).toEqual(['c1', 'c2']);
});

it('surfaces a non-ok response as error, not a silent empty feed', async () => {
  mockApiFetch.mockResolvedValue(response(null, false));
  await act(async () => { root.render(<Harness />); });
  await flush();
  expect(readState().status).toBe('error');
  expect(readState().ids).toEqual([]);
});

it('surfaces an offline/throwing fetch as error', async () => {
  mockApiFetch.mockRejectedValue(new Error('offline'));
  await act(async () => { root.render(<Harness />); });
  await flush();
  expect(readState().status).toBe('error');
  expect(readState().ids).toEqual([]);
});

it('a slow superseded response never clobbers a newer one', async () => {
  const slow = deferred<Response>();
  const fast = deferred<Response>();
  mockApiFetch.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

  await act(async () => { root.render(<Harness />); });   // first (slow) fetch in flight
  // Supersede it → second (fast) fetch.
  await act(async () => { container.querySelector('#reload')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

  await act(async () => { fast.resolve(response({ conflicts: [{ _id: 'fresh' }] })); });
  await flush();
  expect(readState().ids).toEqual(['fresh']);
  expect(readState().status).toBe('ready');

  // The abandoned first request lands late; the `active` latch must drop it.
  await act(async () => { slow.resolve(response({ conflicts: [{ _id: 'stale' }] })); });
  await flush();
  expect(readState().ids).toEqual(['fresh']);
  expect(readState().status).toBe('ready');
});

it('survives Strict Mode double-invocation without wedging on loading', async () => {
  mockApiFetch.mockResolvedValue(response({ conflicts: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }] }));
  await act(async () => {
    root.render(<React.StrictMode><Harness /></React.StrictMode>);
  });
  await flush();
  expect(readState().status).toBe('ready');
  expect(readState().ids).toEqual(['a', 'b', 'c']);
});
