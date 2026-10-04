/**
 * What the SMS gateway has already been asked to send, so a retry of a request
 * whose response was lost (the usual failure on a weak connection) cannot text
 * the patient twice.
 *
 * The key binds the message to the sender and the patient: an id replayed
 * against another patient, or by another account, is a different dispatch.
 *
 * This used to be a Map in the route's own process. A restart, a deploy, or a
 * second instance forgot it — and the retry then sent the same text again, a
 * repeat disclosure on a phone other people may read. It now lives in the
 * shared store the rate limiter already uses (Upstash, when configured), where
 * every instance sees the same claim; a single-instance deployment without it
 * keeps the in-process map, exactly as rate limiting does.
 *
 * Server-only.
 */
import { createHash } from 'node:crypto';
import { getUpstashConfig, upstashPipeline } from '@/lib/rate-limit';
import type { PatientSmsResponse } from './patient-dispatch';

/** A sent text is remembered for a day — longer than the outbox keeps retrying. */
const SENT_TTL_SECONDS = 24 * 60 * 60;
/** A claim nobody settled (the instance died mid-send) frees itself. */
const CLAIM_TTL_SECONDS = 120;
const MAX_LOCAL_ENTRIES = 5000;

type Entry = { state: 'in_flight' } | { state: 'sent'; response: PatientSmsResponse };

export type DispatchClaim =
  | { kind: 'claimed' }
  | { kind: 'sent'; response: PatientSmsResponse }
  | { kind: 'in_flight' };

const local = new Map<string, { entry: Entry; expiresAt: number }>();

function storeKey(key: string): string {
  // Ids, not PHI — hashed anyway so the store never lists who texted whom.
  return `sms-dispatch:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

function localGet(key: string, now: number): Entry | null {
  const hit = local.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    local.delete(key);
    return null;
  }
  return hit.entry;
}

function localSet(key: string, entry: Entry, ttlSeconds: number, now: number): void {
  if (local.size >= MAX_LOCAL_ENTRIES) {
    const oldest = local.keys().next().value;
    if (oldest !== undefined) local.delete(oldest);
  }
  local.set(key, { entry, expiresAt: now + ttlSeconds * 1000 });
}

function parse(raw: unknown): Entry | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as Entry;
    return value && (value.state === 'in_flight' || value.state === 'sent') ? value : null;
  } catch {
    return null;
  }
}

/** The answer already given for this dispatch, if it was sent. Claims nothing. */
export async function recallDispatch(key: string, now: number = Date.now()): Promise<PatientSmsResponse | null> {
  const k = storeKey(key);
  const cfg = getUpstashConfig();
  if (cfg) {
    try {
      const [got] = await upstashPipeline(cfg, [['GET', k]]);
      const entry = parse(got?.result);
      return entry?.state === 'sent' ? entry.response : null;
    } catch (err) {
      console.warn('[sms-dispatch] shared store unavailable; using this instance\'s memory', err);
    }
  }
  const entry = localGet(k, now);
  return entry?.state === 'sent' ? entry.response : null;
}

/**
 * Claim a dispatch before calling the gateway. Atomic in the shared store, so
 * two requests racing — the sender's click and the outbox retry, on one
 * instance or two — cannot both reach the gateway.
 */
export async function claimDispatch(key: string, now: number = Date.now()): Promise<DispatchClaim> {
  const k = storeKey(key);
  const cfg = getUpstashConfig();
  if (cfg) {
    try {
      const [set, got] = await upstashPipeline(cfg, [
        ['SET', k, JSON.stringify({ state: 'in_flight' } satisfies Entry), 'NX', 'EX', CLAIM_TTL_SECONDS],
        ['GET', k],
      ]);
      if (set?.result === 'OK') return { kind: 'claimed' };
      const entry = parse(got?.result);
      return entry?.state === 'sent' ? { kind: 'sent', response: entry.response } : { kind: 'in_flight' };
    } catch (err) {
      console.warn('[sms-dispatch] shared store unavailable; using this instance\'s memory', err);
    }
  }
  const entry = localGet(k, now);
  if (entry?.state === 'sent') return { kind: 'sent', response: entry.response };
  if (entry) return { kind: 'in_flight' };
  localSet(k, { state: 'in_flight' }, CLAIM_TTL_SECONDS, now);
  return { kind: 'claimed' };
}

/** The gateway took the text: remember the answer for any retry. */
export async function settleDispatch(key: string, response: PatientSmsResponse, now: number = Date.now()): Promise<void> {
  const k = storeKey(key);
  const entry: Entry = { state: 'sent', response };
  // Always kept locally too: if the shared store hiccups on this write, this
  // instance at least still refuses its own retries.
  localSet(k, entry, SENT_TTL_SECONDS, now);
  const cfg = getUpstashConfig();
  if (!cfg) return;
  try {
    await upstashPipeline(cfg, [['SET', k, JSON.stringify(entry), 'EX', SENT_TTL_SECONDS]]);
  } catch (err) {
    console.warn('[sms-dispatch] could not record a sent text in the shared store', err);
  }
}

/** The text did not go: give the claim back so a retry can try again. */
export async function releaseDispatch(key: string): Promise<void> {
  const k = storeKey(key);
  if (local.get(k)?.entry.state === 'in_flight') local.delete(k);
  const cfg = getUpstashConfig();
  if (!cfg) return;
  try {
    await upstashPipeline(cfg, [['DEL', k]]);
  } catch (err) {
    console.warn('[sms-dispatch] could not release a dispatch claim (it expires on its own)', err);
  }
}

export function resetDispatchLedgerForTest(): void {
  local.clear();
}
