import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { withAuditLog } from '@/lib/audit/with-audit';
import { reconcileProviderPayment } from '@/lib/services/payment-service';

import {
  verifyFlutterWaveSignature,
  verifyLegacyFlutterWaveHash,
  verifyFlutterWaveTransaction,
  type FlutterWaveWebhookBody,
} from '@/lib/payments/flutterwave-verify';

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
