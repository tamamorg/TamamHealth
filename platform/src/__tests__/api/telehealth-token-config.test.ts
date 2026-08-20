/**
 * The configuration gate on POST /api/telehealth/token.
 *
 * Telehealth "not working" is almost always this: no LiveKit server is
 * configured, so the route answers 503 and the visit room says so instead of
 * showing a call that will never connect. That behaviour is deliberate, but it
 * is also the first thing to check — and the first thing to break silently if
 * the gate ever moves after the auth check, where an unauthenticated caller
 * would get a confusing 401 instead of the real reason.
 *
 * These assert both directions: refused while unconfigured, and past the gate
 * once the three variables are set (a dev machine points them at the LiveKit
 * container in docker-compose.livekit.yml).
 */
jest.mock('next/server', () => {
  // Same plumbing as the other route-handler tests: NextResponse extends the
  // global Response at module-load time, and the jsdom stub has no
  // Response.json.

  const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');

  const { MessageChannel, MessagePort } = require('node:worker_threads');
  Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream, MessageChannel, MessagePort });

  const undici = require('undici');
  Object.assign(globalThis, {
    Response: undici.Response,
    Request: undici.Request,
    Headers: undici.Headers,
    fetch: undici.fetch,
  });
  return jest.requireActual('next/server');
});

jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

// `livekit-server-sdk` resolves its own nested ESM build of `jose`, which the
// project's transformIgnorePatterns does not reach (it only exempts a
// top-level `jose`). Nothing here signs a token — every case is refused before
// that — so the signer is stubbed rather than transformed.
jest.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    addGrant() {}
    async toJwt() { return 'stub.jwt.token'; }
  },
}));

import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/telehealth/token/route';

const LIVEKIT_VARS = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'NEXT_PUBLIC_LIVEKIT_URL'] as const;

const original: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of LIVEKIT_VARS) original[key] = process.env[key];
});

afterEach(() => {
  for (const key of LIVEKIT_VARS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

/** No sessionId on purpose: the request is refused before it reads any data. */
const tokenRequest = () => new Request('http://localhost/api/telehealth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
}) as unknown as NextRequest;

describe('POST /api/telehealth/token — LiveKit configuration gate', () => {
  it('refuses with 503 and names the missing variables when no server is configured', async () => {
    for (const key of LIVEKIT_VARS) delete process.env[key];

    const res = await POST(tokenRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/LIVEKIT_URL/);
  });

  it('still refuses when the configuration is only partial', async () => {
    for (const key of LIVEKIT_VARS) delete process.env[key];
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'devkey';
    // no secret — a token could not be signed, so this must not read as configured

    expect((await POST(tokenRequest())).status).toBe(503);
  });

  it('passes the gate once all three are set', async () => {
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'secret';

    const res = await POST(tokenRequest());
    // 400 for the missing sessionId — i.e. it got past the configuration check
    // and into the request itself, which is all this asserts.
    expect(res.status).toBe(400);
  });
});
