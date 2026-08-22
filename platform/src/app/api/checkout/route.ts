import { NextRequest, NextResponse } from 'next/server';
import { withAuditLog } from '@/lib/audit/with-audit';
import { logApiError, serverError } from '@/modules/identity';
import type { PaymentMethodType } from '@/lib/db-types-payments';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-utils';

/**
 * Public checkout helper for the pay-by-link flow.
 *
 * This route is intentionally UNAUTHENTICATED (see proxy.ts) — a patient
 * or payer opens a link we handed them, so there is no staff session. To avoid
 * leaking PHI it exposes only what a payer needs to pay:
 *
 *   GET  ?linkId=…  → { amount, currency, description, status, expiresAt }
 *                     (NO patientId, NO facility/org ids, NO created-by, NO _id)
 *   POST            → records a *pending* payment tied to the link's reference
 *                     and returns that reference.
 *
 * The actual confirmation is done out-of-band by the payment-gateway webhook
 * (M-Pesa / Airtel / Flutterwave), which matches on `reference` and flips the
 * payment to `posted`. This route never fabricates a completed/posted status.
 */

// Mirror the patient-portal UI method keys onto the canonical PaymentMethodType
// union so the recorded payment is reconcilable with the rest of the system.
const METHOD_MAP: Record<string, PaymentMethodType> = {
  mpesa: 'mpesa',
  mtn: 'mtn_momo',
  airtel: 'airtel',
  m_gurush: 'm_gurush',
  card: 'card',
  bank: 'bank_transfer',
  cash: 'cash',
};

const MOBILE_METHODS = new Set(['mpesa', 'mtn', 'airtel']);
const LINK_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function normalizePhone(value: string): string | null {
  const normalized = value.replace(/[\s().-]/g, '');
  return /^\+?[0-9]{8,15}$/.test(normalized) ? normalized : null;
}

function rateLimited(resetAt: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many checkout attempts. Please try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

function isExpired(expiresAt?: string): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

export async function GET(req: NextRequest) {
  try {
    const verdict = await rateLimit({
      key: `checkout:get:ip:${getClientIp(req)}`, limit: 120, windowMs: 60_000,
    });
    if (!verdict.allowed) return rateLimited(verdict.resetAt);

    const { searchParams } = new URL(req.url);
    const linkId = searchParams.get('linkId') || searchParams.get('id');

    if (!linkId || !LINK_ID_PATTERN.test(linkId)) {
      return NextResponse.json(
        { error: 'A valid linkId query parameter is required' },
        { status: 400 }
      );
    }

    const { getPaymentLink } = await import('@/lib/services/payment-service');
    const link = await getPaymentLink(linkId);

    if (!link) {
      return NextResponse.json(
        { error: 'Payment link not found' },
        { status: 404 }
      );
    }

    // Minimal, payer-facing projection only. Deliberately omit patientId,
    // facilityId, orgId, createdBy, url and the raw doc id so a public link
    // can never be used to enumerate or harvest patient/facility identifiers.
    return NextResponse.json({
      linkId: link.linkId,
      status: link.status,
      amount: link.amount,
      currency: link.currency,
      description: link.description,
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    logApiError('[API /checkout GET]', error);
    return serverError();
  }
}

async function postHandler(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const ipVerdict = await rateLimit({ key: `checkout:ip:${ip}`, limit: 30, windowMs: 60_000 });
    if (!ipVerdict.allowed) return rateLimited(ipVerdict.resetAt);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const allowedFields = new Set(['linkId', 'method', 'payerPhone']);
    if (Object.keys(record).some(key => !allowedFields.has(key))) {
      return NextResponse.json({ error: 'Request contains unsupported fields' }, { status: 400 });
    }

    const linkId = typeof record.linkId === 'string' ? record.linkId.trim() : '';
    const method = typeof record.method === 'string' ? record.method : '';
    const rawPhone = typeof record.payerPhone === 'string' ? record.payerPhone.trim() : '';
    if (!LINK_ID_PATTERN.test(linkId)) {
      return NextResponse.json({ error: 'Invalid linkId' }, { status: 400 });
    }
    if (!Object.hasOwn(METHOD_MAP, method)) {
      return NextResponse.json({ error: 'Unsupported payment method' }, { status: 400 });
    }
    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return NextResponse.json({ error: 'Invalid Idempotency-Key header' }, { status: 400 });
    }
    const payerPhone = rawPhone ? normalizePhone(rawPhone) : null;
    if (MOBILE_METHODS.has(method) && !payerPhone) {
      return NextResponse.json({ error: 'A valid payerPhone is required for mobile money' }, { status: 400 });
    }
    if (!MOBILE_METHODS.has(method) && rawPhone) {
      return NextResponse.json({ error: 'payerPhone is only valid for mobile money' }, { status: 400 });
    }

    const linkVerdict = await rateLimit({ key: `checkout:link:${linkId}`, limit: 10, windowMs: 15 * 60_000 });
    if (!linkVerdict.allowed) return rateLimited(linkVerdict.resetAt);

    const { getPaymentLink, startPaymentLinkAttempt } = await import('@/lib/services/payment-service');
    const link = await getPaymentLink(linkId);

    if (!link) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 });
    }

    // Refuse to record intent against a link that can't take a payment.
    if (link.status === 'used') {
      return NextResponse.json({ error: 'This payment link has already been paid', status: 'used' }, { status: 409 });
    }
    if (link.status === 'expired' || isExpired(link.expiresAt)) {
      return NextResponse.json({ error: 'This payment link has expired', status: 'expired' }, { status: 409 });
    }

    const result = await startPaymentLinkAttempt({
      linkId,
      method: METHOD_MAP[method],
      payerPhone: payerPhone || undefined,
    });

    return NextResponse.json(
      { ok: true, reference: result.payment.reference, status: result.payment.status },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'PAYMENT_LINK_NOT_FOUND') return NextResponse.json({ error: 'Payment link not found' }, { status: 404 });
    if (code === 'PAYMENT_LINK_USED') return NextResponse.json({ error: 'This payment link has already been paid', status: 'used' }, { status: 409 });
    if (code === 'PAYMENT_LINK_EXPIRED') return NextResponse.json({ error: 'This payment link has expired', status: 'expired' }, { status: 409 });
    if (code === 'PAYMENT_LINK_CONFLICT') return NextResponse.json({ error: 'Checkout is busy. Please retry.' }, { status: 409 });
    logApiError('[API /checkout POST]', error);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'checkout.payment.submit' });
