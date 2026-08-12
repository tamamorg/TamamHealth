import crypto from 'node:crypto';
import { getUpstashConfig, hashKey, upstashPipeline, withRetry } from './upstash';

export const SYNC_SIGNATURE_MAX_SKEW_SECONDS = 300;
const NONCE_TTL_SECONDS = SYNC_SIGNATURE_MAX_SKEW_SECONDS * 2;

export interface SyncSignatureInput {
  timestamp: string;
  nonce: string;
  method: string;
  pathname: string;
  body: string;
}

export function buildSyncCanonicalPayload(input: SyncSignatureInput): string {
  return [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathname,
    input.body,
  ].join('\n');
}

export function computeSyncSignature(secret: string, input: SyncSignatureInput): string {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(buildSyncCanonicalPayload(input), 'utf8')
    .digest('hex');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = new Uint8Array(Buffer.from(a, 'utf8'));
  const right = new Uint8Array(Buffer.from(b, 'utf8'));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function isSyncTimestampFresh(timestamp: string, nowMs = Date.now()): boolean {
  if (!/^\d{10}$/.test(timestamp)) return false;
  const timestampMs = Number(timestamp) * 1000;
  return Number.isFinite(timestampMs)
    && Math.abs(nowMs - timestampMs) <= SYNC_SIGNATURE_MAX_SKEW_SECONDS * 1000;
}

const localNonces = new Map<string, number>();

async function reserveNonce(nonce: string): Promise<'ok' | 'replay' | 'unavailable'> {
  const cfg = getUpstashConfig();
  if (cfg) {
    try {
      const hashed = await hashKey(nonce, 'sync-nonce');
      const result = await withRetry(
        () => upstashPipeline(cfg, [['SET', `sync:nonce:${hashed}`, '1', 'NX', 'EX', NONCE_TTL_SECONDS]]),
        'sync-nonce',
      );
      return result[0]?.result === 'OK' ? 'ok' : 'replay';
    } catch (error) {
      console.error('[Sync] shared replay store unavailable:', error);
      return 'unavailable';
    }
  }

  if (process.env.NODE_ENV === 'production') return 'unavailable';
  const now = Date.now();
  for (const [key, expiresAt] of localNonces) {
    if (expiresAt <= now) localNonces.delete(key);
  }
  if (localNonces.has(nonce)) return 'replay';
  localNonces.set(nonce, now + NONCE_TTL_SECONDS * 1000);
  return 'ok';
}

export type SyncVerificationResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: 'invalid' | 'replay' | 'store-unavailable' };

export async function verifySyncMachineRequest(
  request: Request,
  body: string,
): Promise<SyncVerificationResult> {
  const secret = process.env.COUCHDB_WEBHOOK_SECRET || '';
  const signature = request.headers.get('x-tamamhealth-signature') || '';
  const timestamp = request.headers.get('x-tamamhealth-timestamp') || '';
  const nonce = request.headers.get('x-tamamhealth-nonce') || '';

  if (secret.length < 32 || !signature || !isSyncTimestampFresh(timestamp)
      || !/^[0-9a-f-]{36}$/i.test(nonce)) {
    return { ok: false, status: 401, reason: 'invalid' };
  }

  const url = new URL(request.url);
  const expected = computeSyncSignature(secret, {
    timestamp,
    nonce,
    method: request.method,
    pathname: url.pathname,
    body,
  });
  if (!timingSafeEqualStrings(signature, expected)) {
    return { ok: false, status: 401, reason: 'invalid' };
  }

  const nonceResult = await reserveNonce(nonce);
  if (nonceResult === 'unavailable') {
    return { ok: false, status: 503, reason: 'store-unavailable' };
  }
  if (nonceResult === 'replay') {
    return { ok: false, status: 401, reason: 'replay' };
  }
  return { ok: true };
}
