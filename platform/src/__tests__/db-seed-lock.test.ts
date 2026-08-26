/**
 * The seed's cross-tab lock must be BOUNDED.
 *
 * `context.tsx` awaits `seedDatabase()` before it flips `dbReady`, and
 * `dbReady` is what enables the sign-in button. So a `navigator.locks.request`
 * with no timeout is not a slow path — it is a permanent one: a frozen tab, a
 * tab left open across a dev-server restart, or a suspended background tab
 * that holds `tamamhealth-seed` parks every other tab on "Initializing offline
 * database…" with the Log in button disabled and nothing on screen explaining
 * why. Reported 2026-08-26.
 *
 * These exercise the REAL `seedDatabase`, with `navigator.locks` stubbed to
 * behave the way a browser does. The stub never invokes the callback, so the
 * seed itself never runs here — what is under test is the wrapper around it.
 */

export {};

type LockRequest = (name: string, opts: { signal: AbortSignal }, cb: () => Promise<void>) => Promise<void>;

const realNavigator = global.navigator;

function installLocks(request: LockRequest | undefined) {
  Object.defineProperty(global, 'navigator', {
    value: request ? { locks: { request } } : {},
    configurable: true,
  });
}

async function loadSeedDatabase() {
  const mod = await import('@/lib/db-seed');
  return mod.seedDatabase;
}

afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(global, 'navigator', { value: realNavigator, configurable: true });
});

describe('seedDatabase cross-tab lock', () => {
  test('requests the named lock and passes an abort signal', async () => {
    let seen: { name?: string; signal?: AbortSignal } = {};
    // Resolve without running the callback: this asserts how the lock is
    // ASKED for, not what happens inside it.
    installLocks(async (name, opts) => { seen = { name, signal: opts.signal }; });

    const seedDatabase = await loadSeedDatabase();
    await seedDatabase();

    expect(seen.name).toBe('tamamhealth-seed');
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.signal!.aborted).toBe(false);
  });

  test('resolves — rather than hanging — when another tab never releases', async () => {
    // A holder that never yields. The request stays queued until the signal
    // fires, which is what the browser does with LockOptions.signal.
    installLocks((_name, opts) => new Promise<void>((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The request was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    jest.useFakeTimers();
    const seedDatabase = await loadSeedDatabase();
    const pending = seedDatabase();
    // Well past any real seed (~15s measured) — the bound, not the work.
    jest.advanceTimersByTime(60_000);

    await expect(pending).resolves.toBeUndefined();
  });

  test('a genuine lock failure is not swallowed as a timeout', async () => {
    installLocks(async () => { throw new Error('IndexedDB is gone'); });
    const seedDatabase = await loadSeedDatabase();
    await expect(seedDatabase()).rejects.toThrow('IndexedDB is gone');
  });
});
