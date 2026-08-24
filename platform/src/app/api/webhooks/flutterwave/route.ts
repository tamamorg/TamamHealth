import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { withAuditLog } from '@/lib/audit/with-audit';
import { reconcileProviderPayment } from '@/lib/services/payment-service';
import crypto from 'crypto';

interface FlutterWaveCustomer {
  email: string;
  name?: string;
  phone?: string;
}

interface FlutterWaveData {
  id: number;
  tx_ref: string;
  amount: number;
  currency: string;
  status: string;
  payment_type: string;
  customer: FlutterWaveCustomer;
  created_at?: string;
}

interface FlutterWaveWebhookBody {
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

async function postHandler(req: NextRequest) {
  try {
    // Get the raw body and hash from headers
    const signature = req.headers.get('flutterwave-signature');
    const legacyHash = req.headers.get('verif-hash');
    const rawBody = await req.text();

    if (!signature && !legacyHash) {
      console.warn('[Flutterwave Webhook] Missing signature header');
      return NextResponse.json(
        { error: 'Missing verification hash' },
        { status: 400 }
      );
    }

    const flutterWaveSecret = process.env.FLUTTERWAVE_SECRET_HASH;
    if (!flutterWaveSecret) {
      console.error('[Flutterwave Webhook] FLUTTERWAVE_SECRET_HASH not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Verify the webhook signature
    const isValid = signature
      ? verifyFlutterWaveSignature(rawBody, signature, flutterWaveSecret)
      : verifyLegacyFlutterWaveHash(legacyHash!, flutterWaveSecret);
    if (!isValid) {
      console.warn('[Flutterwave Webhook] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse the body
    const body: FlutterWaveWebhookBody = JSON.parse(rawBody);
    const eventType = body.event;
    const data = body.data;

    // Handle charge.completed events
    if (eventType === 'charge.completed') {
      if (data.status === 'successful') {
        // A valid webhook proves who sent the event; the verification endpoint
        // proves the transaction itself settled with these exact values.
        if (!await verifyFlutterWaveTransaction(data)) {
          console.error('[Flutterwave Webhook] Provider verification failed', { id: data.id, txRef: data.tx_ref });
          return NextResponse.json({ error: 'Transaction verification failed' }, { status: 503 });
        }
        // Log only opaque correlators — never the amount or customer email
        // (financial data / PII in stdout).
        console.log('[Flutterwave Webhook] Payment received:', {
          flutterWaveId: data.id,
          txRef: data.tx_ref,
          timestamp: new Date().toISOString(),
        });

        // Match the txRef to the pending payment (stored as the payment's
        // `reference`) and mark it posted. Unknown match is logged but still
        // acked — never throw back at the gateway.
        const reconciliation = await reconcileProviderPayment({
          reference: data.tx_ref,
          provider: 'flutterwave',
          status: 'posted',
          providerReference: Number.isFinite(data.id) ? String(data.id) : undefined,
          amount: data.amount,
          currency: data.currency,
        });
        if (reconciliation.outcome === 'mismatch' || reconciliation.outcome === 'invalid_state') {
          console.warn('[Flutterwave Webhook] Callback did not match pending payment:', {
            txRef: data.tx_ref, reason: reconciliation.reason,
          });
        }

        return NextResponse.json({
          status: 'ok',
          message: 'Payment processed successfully',
        });
      } else if (['failed', 'cancelled'].includes(data.status.toLowerCase())) {
        // Payment unsuccessful
        console.log('[Flutterwave Webhook] Payment unsuccessful:', {
          flutterWaveId: data.id,
          txRef: data.tx_ref,
          status: data.status,
          timestamp: new Date().toISOString(),
        });

        // Mark the matching payment failed; ack the gateway regardless.
        await reconcileProviderPayment({
          reference: data.tx_ref, provider: 'flutterwave', status: 'failed', reason: data.status,
        });

        return NextResponse.json({
          status: 'ok',
          message: 'Payment status recorded',
        });
      } else {
        // A completed event carrying a non-terminal provider state must not
        // prematurely fail the local attempt. A later callback can settle it.
        return NextResponse.json({ status: 'ok', message: 'Non-terminal status acknowledged' });
      }
    } else {
      // Other event types (e.g., charge.failed, transfer.completed, etc.)
      console.log('[Flutterwave Webhook] Event received:', {
        eventType,
        txRef: data.tx_ref,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        status: 'ok',
        message: 'Event acknowledged',
      });
    }
  } catch (error) {
    logApiError('[Flutterwave Webhook] Error processing callback:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
export const POST = withAuditLog(postHandler, { action: 'webhook.flutterwave.receive' });
