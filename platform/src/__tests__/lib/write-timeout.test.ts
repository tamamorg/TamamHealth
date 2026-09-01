/**
 * The shared clinical-write ceiling (lib/write-timeout.ts).
 *
 * One failure mode, four sites (walk-in check-in, registration, triage save,
 * lab-order submit): a local PouchDB/IndexedDB write that stalls under
 * initial-sync contention must become a rejection the form's existing catch
 * can surface — never an unbounded spinner.
 */
import { withTimeout, CLINICAL_WRITE_TIMEOUT_MS } from '@/lib/write-timeout';

describe('withTimeout', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

  it('passes through a resolution and clears its timer', async () => {
    const p = withTimeout(Promise.resolve('ok'), 1_000, 'too slow');
    await expect(p).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('passes through a rejection unchanged (not masked as a timeout)', async () => {
    const p = withTimeout(Promise.reject(new Error('validation failed')), 1_000, 'too slow');
    await expect(p).rejects.toThrow('validation failed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the given message when the promise never settles', async () => {
    const never = new Promise<never>(() => {});
    const p = withTimeout(never, 1_000, 'The local database did not respond.');
    const settled = p.then(() => 'resolved', (e: Error) => e.message);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(settled).resolves.toBe('The local database did not respond.');
  });

  it('does not time out a promise that settles just inside the ceiling', async () => {
    let finish!: (v: string) => void;
    const slow = new Promise<string>(resolve => { finish = resolve; });
    const p = withTimeout(slow, 1_000, 'too slow');
    const settled = p.then(v => v, (e: Error) => e.message);
    await jest.advanceTimersByTimeAsync(999);
    finish('made it');
    await expect(settled).resolves.toBe('made it');
  });

  it('exports a ceiling far above a healthy sub-second local write', () => {
    expect(CLINICAL_WRITE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });
});
