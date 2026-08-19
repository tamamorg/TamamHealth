/**
 * Signing in must not wait on CouchDB.
 *
 * The sign-in handler awaits `loginCouch` inline so replication can start with
 * a live session. That call is documented as best-effort — a failure just means
 * no sync this session — but it was a bare `fetch`, and a bare fetch to a host
 * that drops packets does not fail: it hangs for the browser's own TCP timeout.
 *
 * The symptom in production was a sign-in button stuck on "Signing in…" for the
 * better part of a minute, then succeeding, every single time, because the
 * CouchDB host the bundle points at was unreachable. `whoamiCouch` has the same
 * shape and runs on every page load, ahead of restoring a session.
 */
const ORIGINAL_URL = process.env.NEXT_PUBLIC_COUCHDB_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_COUCHDB_URL = 'https://couch.example.invalid';
});
afterAll(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_COUCHDB_URL;
  else process.env.NEXT_PUBLIC_COUCHDB_URL = ORIGINAL_URL;
});
afterEach(() => { jest.restoreAllMocks(); });

/**
 * A fetch that never settles until its abort signal fires — a dead host. Used
 * by the one test that proves the timeout actually fires; it costs the real
 * timeout in wall-clock, so the others use `refusingFetch` instead.
 */
function hangingFetch() {
  return jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // no signal => hangs forever, which is the bug
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  }));
}

/** A fetch that fails immediately, the way a refused connection does. */
function refusingFetch() {
  return jest.fn(async (_url: string, _init?: RequestInit) => {
    throw new TypeError('Failed to fetch');
  });
}

/** Minimal stand-in for a fetch Response — jsdom's is not usable here. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('CouchDB auth calls are bounded', () => {
  it('loginCouch passes an abort signal so a dead host cannot hang sign-in', async () => {
    const fetchMock = hangingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { loginCouch } = await import('@/lib/sync/couch-client-auth');

    const result = await loginCouch('desk.amira', 'pw');

    expect(fetchMock).toHaveBeenCalled();
    // The guarantee: an AbortSignal was attached. Without one the promise above
    // never settles and this test times out — which is exactly what the sign-in
    // button was doing.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it('reports the unreachable host as a plain failure, not a thrown error', async () => {
    global.fetch = refusingFetch() as unknown as typeof fetch;
    const { loginCouch } = await import('@/lib/sync/couch-client-auth');
    // Callers treat "unreachable" and "refused" identically; neither may throw,
    // because the sign-in handler's catch would otherwise swallow a real login.
    await expect(loginCouch('desk.amira', 'pw')).resolves.toMatchObject({ ok: false });
  });

  it('whoamiCouch is bounded too — it runs before every session restore', async () => {
    const fetchMock = refusingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { whoamiCouch } = await import('@/lib/sync/couch-client-auth');

    await expect(whoamiCouch()).resolves.toEqual({ ok: false });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a reachable CouchDB still logs in and returns its roles', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, {
      ok: true, name: 'desk.amira', roles: ['org:org-moh-ss', 'role:front_desk'],
    })) as unknown as typeof fetch;
    const { loginCouch } = await import('@/lib/sync/couch-client-auth');

    await expect(loginCouch('desk.amira', 'pw')).resolves.toMatchObject({
      ok: true,
      status: 200,
      roles: ['org:org-moh-ss', 'role:front_desk'],
    });
  });
});
