/**
 * The chart's billing tab posts refunds through issueRefund. A double click on
 * the confirm button must reach the service once, under one idempotency key,
 * and a refused refund must leave the dialog open with the reason shown.
 */
import React from 'react';
import { act, click, flush, mountAndFlush, qa, type Mounted } from '../clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => {
  const map = (jest.requireActual('@/lib/i18n/locales/en') as { default: Record<string, string> }).default;
  return { useTranslation: () => ({ t: (key: string) => map[key] ?? key }) };
});
// Stable references: the tab reloads whenever the scope identity changes.
const AUTH = { currentUser: { _id: 'u1', name: 'Cashier One', role: 'cashier', hospitalId: 'h1', orgId: 'o1' } };
const SCOPE = { orgId: 'o1' };
jest.mock('@/lib/context', () => ({ useAuth: () => AUTH }));
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => SCOPE }));
const showToast = jest.fn();
const TOAST = { showToast };
jest.mock('@/components/Toast', () => ({ useToast: () => TOAST }));
jest.mock('@/components/Modal', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/Select', () => ({ __esModule: true, default: (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} /> }));
jest.mock('@/components/payments', () => ({ PaymentPanel: () => null, PaymentPlanWizard: () => null }));
jest.mock('@/components/payments/InsurancePolicyModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/modules/financial-clearance/client', () => ({ VisitFinancialReview: () => null }));
jest.mock('@/modules/insurance/client', () => ({}));
jest.mock('@/components/patients/SuperbillPanel', () => ({
  useSuperbill: () => ({ busy: false, error: '', posted: false, lines: [] }),
  SuperbillPicker: () => null,
  SuperbillDraft: () => null,
}));
jest.mock('@/lib/services/ledger-service', () => ({ getPatientLedger: jest.fn(async () => []) }));

const payment = {
  _id: 'pay-1', type: 'payment', patientId: 'pat-1', method: 'cash', amount: 50, currency: 'SSP',
  status: 'posted', processedAt: '2026-10-01T08:00:00.000Z', processedByName: 'Cashier One',
};
const issueRefund = jest.fn();
jest.mock('@/lib/services/payment-service', () => ({
  getPaymentsByPatient: jest.fn(async () => [payment]),
  getChargesByPatient: jest.fn(async () => []),
  getPaymentPlansByPatient: jest.fn(async () => []),
  getPatientInsurancePolicies: jest.fn(async () => []),
  getRefundsByPatient: jest.fn(async () => []),
  issueRefund: (...args: unknown[]) => issueRefund(...args),
}));

import BillingTab from '@/components/patients/BillingTab';
import type { PatientDoc } from '@/lib/db-types';

const patient = { _id: 'pat-1', firstName: 'Mary', surname: 'Akol', hospitalNumber: 'H-1' } as unknown as PatientDoc;

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; jest.clearAllMocks(); });

const byText = (root: ParentNode, text: string) =>
  qa<HTMLButtonElement>(root, 'button').find(b => b.textContent?.includes(text));

async function openRefundDialog() {
  mounted = await mountAndFlush(
    <BillingTab patient={patient} patientBalance={0} showPaymentPanel={false} showPlanWizard={false}
      setShowPaymentPanel={() => {}} setShowPlanWizard={() => {}} reloadPayments={() => {}} />,
  );
  await act(async () => { click(byText(mounted!.container, 'Billing actions')!); await flush(); });
  await act(async () => { click(byText(mounted!.container, 'Issue refund')!); await flush(); });
  const reason = mounted.container.querySelector<HTMLTextAreaElement>('#bl-refund-reason')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(reason, 'Duplicate charge');
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
}

const confirmButton = () => qa<HTMLButtonElement>(mounted!.container, '.tm-dialog__foot button.btn-primary').pop()!;

describe('BillingTab refund dialog', () => {
  it('posts one refund with one idempotency key when confirm is double clicked', async () => {
    let release: () => void = () => {};
    issueRefund.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    await openRefundDialog();

    await act(async () => { click(confirmButton()); click(confirmButton()); await flush(); });
    expect(issueRefund).toHaveBeenCalledTimes(1);
    expect(issueRefund.mock.calls[0][0].idempotencyKey).toEqual(expect.stringContaining('refund:pay-1:5000:'));
    expect(confirmButton().disabled).toBe(true);

    await act(async () => { release(); await flush(); });
    expect(showToast).toHaveBeenCalledWith('Refund issued.', 'success');
  });

  it('keeps the dialog open, shows the reason, and retries under the same key after a refusal', async () => {
    issueRefund.mockRejectedValueOnce(new Error('Refund exceeds the amount remaining on this payment')).mockResolvedValueOnce(undefined);
    await openRefundDialog();

    await act(async () => { click(confirmButton()); await flush(); });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Refund exceeds the amount remaining'), 'error');
    expect(showToast).not.toHaveBeenCalledWith('Refund issued.', 'success');
    expect(mounted!.container.querySelector('#bl-refund-reason')).not.toBeNull();

    await act(async () => { click(confirmButton()); await flush(); });
    expect(issueRefund).toHaveBeenCalledTimes(2);
    expect(issueRefund.mock.calls[1][0].idempotencyKey).toBe(issueRefund.mock.calls[0][0].idempotencyKey);
  });
});
