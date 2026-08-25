/**
 * Flutterwave webhook verification, and the shapes it verifies.
 *
 * These live here rather than in the route because Next 16 types a route
 * module as handlers-only: any other export fails the build with
 * "does not satisfy the constraint '{ [x: string]: never; }'". They were
 * exported from route.ts for the tests to reach, which broke `tsc` for the
 * whole package — every commit, not just the webhook's.
 */

import crypto from 'crypto';

export interface FlutterWaveCustomer {
  email: string;
  name?: string;
  phone?: string;
}

export interface FlutterWaveData {
  id: number;
  tx_ref: string;
  amount: number;
  currency: string;
  status: string;
  payment_type: string;
  customer: FlutterWaveCustomer;
  created_at?: string;
}

export interface FlutterWaveWebhookBody {
  event: string;
  data: FlutterWaveData;
}

export function verifyFlutterWaveSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  const expected = new TextEncoder().encode(computed);
  const received = new TextEncoder().encode(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export function verifyLegacyFlutterWaveHash(hash: string, secret: string): boolean {
  const expected = new TextEncoder().encode(secret);
  const received = new TextEncoder().encode(hash);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function verifyFlutterWaveTransaction(data: FlutterWaveData): Promise<boolean> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return false;
  const base = (process.env.FLUTTERWAVE_API_BASE_URL || 'https://api.flutterwave.com/v3').replace(/\/$/, '');
  const response = await fetch(`${base}/transactions/${encodeURIComponent(String(data.id))}/verify`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const body = await response.json() as {
    status?: string;
    data?: { id?: number; tx_ref?: string; amount?: number; currency?: string; status?: string };
  };
  const verified = body.data;
  return body.status === 'success'
    && verified?.status === 'successful'
    && verified.id === data.id
    && verified.tx_ref === data.tx_ref
    && Math.round(Number(verified.amount) * 100) === Math.round(data.amount * 100)
    && verified.currency?.toUpperCase() === data.currency.toUpperCase();
}
