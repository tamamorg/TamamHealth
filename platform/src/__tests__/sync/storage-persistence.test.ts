/**
 * @jest-environment jsdom
 *
 * IndexedDB is evictable unless the origin asks not to be.
 *
 * `local-wipe.ts` never destroys a database holding unsynced writes — but that
 * care only governs wipes the platform performs. Automatic eviction under
 * storage pressure is the browser's decision, runs no application code, and
 * takes the same unsynced charts plus the offline sign-in credential with it.
 * Nothing in the platform had ever asked for durable storage.
 *
 * The request is best-effort by definition, so what these tests pin is that it
 * is made once, that every refusal is survivable, and that it never throws into
 * the boot path that calls it.
 */
import { ensurePersistentStorage, _resetPersistenceForTest } from '@/lib/storage-persistence';

const withStorage = (impl: Partial<StorageManager> | undefined) => {
  Object.defineProperty(navigator, 'storage', {
    value: impl, configurable: true, writable: true,
  });
};

beforeEach(() => {
  _resetPersistenceForTest();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('asking for durable storage', () => {
  it('reports success when the browser grants it', async () => {
    withStorage({ persisted: jest.fn().mockResolvedValue(false), persist: jest.fn().mockResolvedValue(true) });
    await expect(ensurePersistentStorage()).resolves.toBe('persisted');
  });

  it('does not re-ask when a previous visit was already granted', async () => {
    const persist = jest.fn().mockResolvedValue(true);
    withStorage({ persisted: jest.fn().mockResolvedValue(true), persist });
    await expect(ensurePersistentStorage()).resolves.toBe('persisted');
    // Firefox can re-prompt on a repeat call, and the answer cannot change.
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks only once per session even when called from several places', async () => {
    const persist = jest.fn().mockResolvedValue(true);
    withStorage({ persisted: jest.fn().mockResolvedValue(false), persist });
    await Promise.all([ensurePersistentStorage(), ensurePersistentStorage(), ensurePersistentStorage()]);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('a refusal is survivable', () => {
  it('reports denial without throwing — the device is where it already was', async () => {
    withStorage({ persisted: jest.fn().mockResolvedValue(false), persist: jest.fn().mockResolvedValue(false) });
    await expect(ensurePersistentStorage()).resolves.toBe('denied');
  });

  it('warns an operator once, because eviction risk is otherwise invisible', async () => {
    withStorage({ persisted: jest.fn().mockResolvedValue(false), persist: jest.fn().mockResolvedValue(false) });
    await ensurePersistentStorage();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('evictable'));
  });

  it('handles an older WebView with no Storage API', async () => {
    withStorage(undefined);
    await expect(ensurePersistentStorage()).resolves.toBe('unsupported');
  });

  it('handles a context that throws instead of resolving false', async () => {
    withStorage({
      persisted: jest.fn().mockRejectedValue(new Error('private mode')),
      persist: jest.fn(),
    });
    await expect(ensurePersistentStorage()).resolves.toBe('unsupported');
  });

  it('never rejects, whatever the browser does', async () => {
    withStorage({ persist: jest.fn().mockRejectedValue(new Error('nope')), persisted: jest.fn().mockResolvedValue(false) });
    await expect(ensurePersistentStorage()).resolves.toBe('unsupported');
  });
});
