import { NextRequest, NextResponse } from 'next/server';
import { withAuditLog } from '@/lib/audit/with-audit';
import { reconcileProviderPayment } from '@/lib/services/payment-service';
import crypto from 'crypto';

/**
 * Optional HMAC verification. Daraja/M-Pesa doesn't sign STK callbacks the way
 * Flutterwave does, but operators commonly front the webhook with a gateway
 * that adds an `x-webhook-signature` HMAC. Mirror Flutterwave's pattern: if a
 * secret is configured, reject mismatched signatures; if it isn't, log a
 * warning and proceed (preserving current dev behaviour).
 */
function verifyMpesaSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.MPESA_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[M-Pesa Webhook] MPESA_WEBHOOK_SECRET not configured — refusing unsigned production webhook');
      return false;
    }
    console.warn('[M-Pesa Webhook] MPESA_WEBHOOK_SECRET not configured — skipping signature verification in non-production');
    return true;
  }
  if (!signature) {
    console.warn('[M-Pesa Webhook] Missing signature header while MPESA_WEBHOOK_SECRET is set');
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

interface CallbackMetadataItem {
  Name: string;
  Value: string | number;
}

interface STKCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: {
    Item: CallbackMetadataItem[];
  };
}

interface MPesaWebhookBody {
  Body?: {
    stkCallback: STKCallback;
  };
}

async function postHandler(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify signature when a secret is configured (no-op in dev otherwise).
    const signature = req.headers.get('x-webhook-signature');
    if (!verifyMpesaSignature(rawBody, signature)) {
      console.warn('[M-Pesa Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let body: MPesaWebhookBody;
    try {
      body = JSON.parse(rawBody) as MPesaWebhookBody;
    } catch {
      return NextResponse.json(
        { error: 'Invalid callback format' },
        { status: 400 }
      );
    }

    // Validate M-Pesa STK Push callback structure
    if (!body?.Body?.stkCallback) {
      return NextResponse.json(
        { error: 'Invalid callback format' },
        { status: 400 }
      );
    }

    const callback = body.Body.stkCallback;
    const resultCode = callback.ResultCode;
    const resultDesc = callback.ResultDesc;
    const checkoutRequestId = callback.CheckoutRequestID;
    const merchantRequestId = callback.MerchantRequestID;

    if (resultCode === 0) {
      // Successful payment — extract only what we persist. The receipt number
      // becomes the provider reference; the payer phone / amount / date are
      // intentionally NOT captured here to keep PII out of the log below.
      const items = callback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = items.find(
        (i) => i.Name === 'MpesaReceiptNumber'
      )?.Value;
      const mpesaAmount = items.find((i) => i.Name === 'Amount')?.Value;

      // Log only opaque transaction correlators — never the payer phone
      // number, receipt number, or amount (PII / financial data in stdout).
      console.log('[M-Pesa Webhook] Payment received:', {
        checkoutRequestId,
        merchantRequestId,
        timestamp: new Date().toISOString(),
      });

      // Match the checkoutRequestId to the pending payment (stored as the
      // payment's `reference`) and mark it posted. A missing/unknown match is
      // logged but still acked — never throw back at the gateway.
      const reconciliation = await reconcileProviderPayment({
        reference: checkoutRequestId,
        provider: 'mpesa',
        status: 'posted',
        providerReference: mpesaReceiptNumber === undefined ? undefined : String(mpesaReceiptNumber),
        amount: typeof mpesaAmount === 'number' ? mpesaAmount : Number(mpesaAmount),
        // Daraja callbacks do not carry currency. The configured integration
        // currency is therefore the trusted provider-side value.
        currency: process.env.MPESA_CURRENCY || 'KES',
      });
      if (reconciliation.outcome === 'mismatch' || reconciliation.outcome === 'invalid_state') {
        console.warn('[M-Pesa Webhook] Callback did not match pending payment:', {
          checkoutRequestId, reason: reconciliation.reason,
        });
      }

      return NextResponse.json({
        ResultCode: 0,
        ResultDesc: 'Accepted',
      });
    } else {
      // Payment failed or cancelled
      console.log('[M-Pesa Webhook] Payment failed:', {
        resultCode,
        resultDesc,
        checkoutRequestId,
        merchantRequestId,
        timestamp: new Date().toISOString(),
      });

      // Mark the matching payment failed; ack the gateway regardless.
      await reconcileProviderPayment({
        reference: checkoutRequestId, provider: 'mpesa', status: 'failed', reason: resultDesc,
      });

      return NextResponse.json({
        ResultCode: 0,
        ResultDesc: 'Accepted',
      });
    }
  } catch (error) {
    console.error('[M-Pesa Webhook] Error processing callback:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
export const POST = withAuditLog(postHandler, { action: 'webhook.mpesa.receive' });
