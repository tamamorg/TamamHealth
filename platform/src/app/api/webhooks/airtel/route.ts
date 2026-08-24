import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { withAuditLog } from '@/lib/audit/with-audit';
import { reconcileProviderPayment } from '@/lib/services/payment-service';
import crypto from 'crypto';

/**
 * Optional HMAC verification, mirroring Flutterwave's pattern. Airtel Money's
 * callback signing varies by integration, so we accept an `x-auth-signature`
 * HMAC. If `AIRTEL_WEBHOOK_SECRET` is set we reject mismatches; if it isn't we
 * log a warning and proceed (preserving current dev behaviour).
 */
function verifyAirtelSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.AIRTEL_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Airtel Webhook] AIRTEL_WEBHOOK_SECRET not configured — refusing unsigned production webhook');
      return false;
    }
    console.warn('[Airtel Webhook] AIRTEL_WEBHOOK_SECRET not configured — skipping signature verification in non-production');
    return true;
  }
  if (!signature) {
    console.warn('[Airtel Webhook] Missing signature header while AIRTEL_WEBHOOK_SECRET is set');
    return false;
  }
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(
    a as unknown as Uint8Array,
    b as unknown as Uint8Array,
  );
}

interface AirtelTransaction {
  id: string;
  status_code: string;
  message: string;
  airtel_money_id?: string;
  transaction_amount: number;
  transaction_currency_code: string;
  payment_date: string;
}

interface AirtelWebhookBody {
  transaction?: AirtelTransaction;
}

async function postHandler(req: NextRequest) {
  try {
    if (
      process.env.NODE_ENV === 'production'
      && process.env.AIRTEL_WEBHOOK_GATEWAY_VERIFIED !== 'true'
    ) {
      console.warn('[Airtel Webhook] Callback disabled — upstream gateway verification has not been confirmed');
      return NextResponse.json({ error: 'Airtel callback is not enabled' }, { status: 503 });
    }

    const rawBody = await req.text();

    const signature = req.headers.get('x-auth-signature');
    if (!verifyAirtelSignature(rawBody, signature)) {
      console.warn('[Airtel Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let body: AirtelWebhookBody;
    try {
      body = JSON.parse(rawBody) as AirtelWebhookBody;
    } catch {
      return NextResponse.json(
        { error: 'Invalid callback format' },
        { status: 400 }
      );
    }

    // Validate Airtel Money callback structure
    if (!body?.transaction) {
      return NextResponse.json(
        { error: 'Invalid callback format' },
        { status: 400 }
      );
    }

    const transaction = body.transaction;
    const {
      id,
      status_code,
      message,
      airtel_money_id,
    } = transaction;

    // Airtel Money success status codes
    const successCodes = ['00', 'SUCCESS', 'success'];
    const isSuccessful = successCodes.includes(status_code);
    const failureCodes = ['TF', 'FAILED', 'FAILURE', 'failed', 'CANCELLED', 'cancelled'];

    if (isSuccessful) {
      // Log only opaque transaction correlators — never the amount or payer
      // details (financial data / PII in stdout).
      console.log('[Airtel Webhook] Payment received:', {
        transactionId: id,
        airtelMoneyId: airtel_money_id,
        timestamp: new Date().toISOString(),
      });

      // Match the transaction id to the pending payment (stored as the
      // payment's `reference`) and mark it posted. Unknown match is logged but
      // still acked — never throw back at the gateway.
      const reconciliation = await reconcileProviderPayment({
        reference: id,
        provider: 'airtel',
        status: 'posted',
        providerReference: airtel_money_id,
        amount: transaction.transaction_amount,
        currency: transaction.transaction_currency_code,
      });
      if (reconciliation.outcome === 'mismatch' || reconciliation.outcome === 'invalid_state') {
        console.warn('[Airtel Webhook] Callback did not match pending payment:', {
          transactionId: id, reason: reconciliation.reason,
        });
      }

      return NextResponse.json({
        resultCode: 0,
        resultDesc: 'Accepted',
        timestamp: new Date().toISOString(),
      });
    } else if (failureCodes.includes(status_code)) {
      // Payment failed or cancelled
      console.log('[Airtel Webhook] Payment failed:', {
        transactionId: id,
        statusCode: status_code,
        message,
        timestamp: new Date().toISOString(),
      });

      // Mark the matching payment failed; ack the gateway regardless.
      await reconcileProviderPayment({
        reference: id, provider: 'airtel', status: 'failed', reason: message,
      });

      return NextResponse.json({
        resultCode: 0,
        resultDesc: 'Accepted',
        timestamp: new Date().toISOString(),
      });
    } else {
      // Pending/unknown provider states are acknowledgements, not terminal
      // failures. Leave the local payment pending for a later callback.
      return NextResponse.json({
        resultCode: 0,
        resultDesc: 'Non-terminal status accepted',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logApiError('[Airtel Webhook] Error processing callback:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
export const POST = withAuditLog(postHandler, { action: 'webhook.airtel.receive' });
