/** @jest-environment node
 *
 * The record of which texts the gateway has already been asked to send.
 *
 * It was a Map inside one server process: a restart, a deploy or a second
 * instance forgot it, and a retried request then texted the patient again.
 * These tests run it against a stand-in for the shared store and check the two
 * things that matter — a text is sent once however many instances are asked,
 * and a text that did NOT go can still be retried.
 */
type Command = (string | number)[];
const redis = new Map<string, string>();
let shared = true;
let storeDown = false;
const pipeline = jest.fn(async (_cfg: unknown, commands: Command[]) => {
  if (storeDown) throw new Error('Upstash 5xx: 503');
  return commands.map(([op, key, value, ...rest]) => {
    const k = String(key);
    if (op === 'GET') return { result: redis.get(k) ?? null };
    if (op === 'DEL') return { result: redis.delete(k) ? 1 : 0 };
    if (op === 'SET') {
      if (rest.includes('NX') && redis.has(k)) return { result: null };
      redis.set(k, String(value));
      return { result: 'OK' };
    }
    return { error: `unsupported ${op}` };
  });
});
jest.mock('@/lib/rate-limit', () => ({
  getUpstashConfig: () => (shared ? { url: 'https://kv.example', token: 't' } : null),
  upstashPipeline: (cfg: unknown, commands: Command[]) => pipeline(cfg, commands),
}));

import type { PatientSmsResponse } from '@/lib/sms/patient-dispatch';

const SENT: PatientSmsResponse = { state: 'sent', provider: 'africastalking', providerMessageId: 'AT1', to: '091•••••145' };
const KEY = 'user-1:pat-1:msg-1';

/** A second server instance: its own module state, the same shared store. */
async function instance() {
  let ledger!: typeof import('@/lib/sms/dispatch-ledger');
  await jest.isolateModulesAsync(async () => { ledger = await import('@/lib/sms/dispatch-ledger'); });
  return ledger;
}

beforeEach(() => {
  redis.clear();
  shared = true;
  storeDown = false;
  pipeline.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('with a shared store', () => {
  it('lets one instance claim a text and tells the other it is in flight', async () => {
    const a = await instance();
    const b = await instance();
    expect(await a.claimDispatch(KEY)).toEqual({ kind: 'claimed' });
    expect(await b.claimDispatch(KEY)).toEqual({ kind: 'in_flight' });
  });

  it('answers a retry on ANOTHER instance with what was already sent', async () => {
    const a = await instance();
    const b = await instance();
    await a.claimDispatch(KEY);
    await a.settleDispatch(KEY, SENT);

    // A restart or a second replica has none of the first one's memory.
    expect(await b.recallDispatch(KEY)).toEqual(SENT);
    expect(await b.claimDispatch(KEY)).toEqual({ kind: 'sent', response: SENT });
  });

  it('lets a text that did not go be tried again', async () => {
    const a = await instance();
    const b = await instance();
    await a.claimDispatch(KEY);
    await a.releaseDispatch(KEY);
    expect(await b.recallDispatch(KEY)).toBeNull();
    expect(await b.claimDispatch(KEY)).toEqual({ kind: 'claimed' });
  });

  it('keeps separate dispatches separate, and stores no ids in the clear', async () => {
    const a = await instance();
    await a.claimDispatch(KEY);
    await a.settleDispatch(KEY, SENT);
    expect(await a.recallDispatch('user-2:pat-1:msg-1')).toBeNull();
    expect(await a.recallDispatch('user-1:pat-2:msg-1')).toBeNull();
    expect([...redis.keys()].join(' ')).not.toMatch(/user-1|pat-1|msg-1/);
  });

  it('falls back to its own memory when the store is unreachable, rather than sending blind', async () => {
    const a = await instance();
    storeDown = true;
    expect(await a.claimDispatch(KEY)).toEqual({ kind: 'claimed' });
    expect(await a.claimDispatch(KEY)).toEqual({ kind: 'in_flight' });
    await a.settleDispatch(KEY, SENT);
    expect(await a.recallDispatch(KEY)).toEqual(SENT);
  });
});

describe('without one (a single instance)', () => {
  it('still refuses to send the same text twice', async () => {
    shared = false;
    const a = await instance();
    expect(await a.claimDispatch(KEY)).toEqual({ kind: 'claimed' });
    expect(await a.claimDispatch(KEY)).toEqual({ kind: 'in_flight' });
    await a.settleDispatch(KEY, SENT);
    expect(await a.claimDispatch(KEY)).toEqual({ kind: 'sent', response: SENT });
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('forgets a claim nobody settled once it expires', async () => {
    shared = false;
    const a = await instance();
    const t0 = 1_000_000;
    expect(await a.claimDispatch(KEY, t0)).toEqual({ kind: 'claimed' });
    expect(await a.claimDispatch(KEY, t0 + 60_000)).toEqual({ kind: 'in_flight' });
    expect(await a.claimDispatch(KEY, t0 + 121_000)).toEqual({ kind: 'claimed' });
  });
});
