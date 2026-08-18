jest.mock('uuid', () => {
  let counter = 0;
  return { v4: () => `${String(++counter).padStart(8, '0')}-0000-4000-8000-000000000000` };
});
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
jest.mock('@/lib/services/ledger-service', () => ({
  createLedgerEntry: jest.fn(), getPatientBalance: jest.fn(),
}));

import { paymentsDB } from '@/lib/db';
import { teardownTestDBs } from '../helpers/test-db';
import {
  createPaymentLink, reconcileProviderPayment, startPaymentLinkAttempt,
} from '@/lib/services/payment-service';
import type { PaymentDoc } from '@/lib/db-types-payments';

afterEach(async () => {
  await teardownTestDBs();
  jest.clearAllMocks();
});

async function seedLink() {
  return createPaymentLink({
    linkId: '0123456789abcdef0123456789abcdef',
    url: 'https://example.test/checkout/link', patientId: 'pat-1',
    amount: 125, currency: 'SSP', description: 'Invoice',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    facilityId: 'hosp-1', orgId: 'org-1', createdBy: 'user-1',
  });
}

describe('payment security controls', () => {
  test('concurrent checkout replay creates only one active payment', async () => {
    await seedLink();
    const calls = Array.from({ length: 8 }, () => startPaymentLinkAttempt({
      linkId: '0123456789abcdef0123456789abcdef', method: 'airtel', payerPhone: '+211912345678',
    }));
    const results = await Promise.allSettled(calls);
    const successful = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof startPaymentLinkAttempt>>> => r.status === 'fulfilled');
    expect(successful.length).toBeGreaterThan(0);
    expect(new Set(successful.map(result => result.value.payment._id)).size).toBe(1);

    const all = await paymentsDB().allDocs({ include_docs: true });
    const payments = all.rows.map(row => row.doc).filter(doc => (doc as PaymentDoc | undefined)?.type === 'payment');
    expect(payments).toHaveLength(1);
  });

  test('replay after creation returns the same pending attempt', async () => {
    await seedLink();
    const first = await startPaymentLinkAttempt({
      linkId: '0123456789abcdef0123456789abcdef', method: 'airtel', payerPhone: '+211912345678',
    });
    const replay = await startPaymentLinkAttempt({
      linkId: '0123456789abcdef0123456789abcdef', method: 'airtel', payerPhone: '+211912345678',
    });
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.payment._id).toBe(first.payment._id);
  });

  test('does not post on amount, currency, or provider mismatch', async () => {
    await seedLink();
    const { payment } = await startPaymentLinkAttempt({
      linkId: '0123456789abcdef0123456789abcdef', method: 'airtel', payerPhone: '+211912345678',
    });
    for (const input of [
      { amount: 1, currency: 'SSP', provider: 'airtel' as const },
      { amount: 125, currency: 'USD', provider: 'airtel' as const },
      { amount: 125, currency: 'SSP', provider: 'flutterwave' as const },
    ]) {
      const result = await reconcileProviderPayment({
        reference: payment.reference!, status: 'posted', providerReference: 'provider-1', ...input,
      });
      expect(result.outcome).toBe('mismatch');
    }
    expect((await paymentsDB().get(payment._id) as PaymentDoc).status).toBe('pending');
  });

  test('posts only an exactly reconciled callback and treats its retry as a duplicate', async () => {
    await seedLink();
    const { payment } = await startPaymentLinkAttempt({
      linkId: '0123456789abcdef0123456789abcdef', method: 'airtel', payerPhone: '+211912345678',
    });
    const callback = {
      reference: payment.reference!, provider: 'airtel' as const, status: 'posted' as const,
      providerReference: 'airtel-receipt-1', amount: 125, currency: 'ssp',
    };
    expect((await reconcileProviderPayment(callback)).outcome).toBe('updated');
    expect((await reconcileProviderPayment(callback)).outcome).toBe('duplicate');
    const stored = await paymentsDB().get(payment._id) as PaymentDoc;
    expect(stored).toMatchObject({
      status: 'posted', provider: 'airtel', providerReference: 'airtel-receipt-1',
    });
  });
});
