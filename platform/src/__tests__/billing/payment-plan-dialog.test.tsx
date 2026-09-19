import React from 'react';
import { mountAndFlush, clickAsync, actFlush } from '../components/clinical-notes/test-utils';
import PaymentPlanWizard from '@/components/payments/PaymentPlanWizard';

const mockScope = { orgId: 'org', hospitalId: 'facility', userId: 'biller', role: 'biller' };
const mockT = (key: string) => key;
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => mockScope }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: { _id: 'biller', name: 'Biller', hospitalId: 'facility', orgId: 'org' } }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/lib/services/ledger-service', () => ({ getPatientLedger: jest.fn() }));
jest.mock('@/lib/services/payment-service', () => ({ createPaymentPlan: jest.fn() }));
import { getPatientLedger } from '@/lib/services/ledger-service';
import { createPaymentPlan } from '@/lib/services/payment-service';

const button = (key: string) => Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes(key))!;
const props = { patientId: 'synthetic', patientName: 'Synthetic patient', balance: 999, currency: 'USD', encounterIds: [], onComplete: jest.fn(), onCancel: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  (getPatientLedger as jest.Mock).mockResolvedValue([{ currency: 'USD', amount: 100 }, { currency: 'SSP', amount: 900 }]);
});

it('uses the selected currency, preserves the selected term after failure and completes explicitly', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  (createPaymentPlan as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ _id: 'new-plan' });
  const mounted = await mountAndFlush(<PaymentPlanWizard {...props} />);
  try {
    await clickAsync(button('payments.reviewPlan'));
    await clickAsync(button('payments.createPlan'));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('payments.planFailed');
    expect(props.onComplete).not.toHaveBeenCalled();
    await clickAsync(button('payments.createPlan'));
    expect(createPaymentPlan).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'USD', totalBalance: 100, termMonths: 3 }));
    expect(document.body.textContent).toContain('payments.planCreated');
    expect(props.onComplete).not.toHaveBeenCalled();
    await clickAsync(button('action.close'));
    expect(props.onComplete).toHaveBeenCalledWith('new-plan');
  } finally { mounted.unmount(); log.mockRestore(); }
});

it('does not dismiss or navigate backwards during a pending save', async () => {
  let finish!: (value: { _id: string }) => void;
  (createPaymentPlan as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const mounted = await mountAndFlush(<PaymentPlanWizard {...props} />);
  try {
    await clickAsync(button('payments.reviewPlan'));
    await clickAsync(button('payments.createPlan'));
    expect(button('action.back').disabled).toBe(true);
    await actFlush(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(props.onCancel).not.toHaveBeenCalled();
    await actFlush(() => finish({ _id: 'saved' }));
  } finally { mounted.unmount(); }
});

it('does not advance on an unreadable balance', async () => {
  (getPatientLedger as jest.Mock).mockRejectedValue(new Error('unavailable'));
  const mounted = await mountAndFlush(<PaymentPlanWizard {...props} />);
  try {
    expect(button('payments.reviewPlan').disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(createPaymentPlan).not.toHaveBeenCalled();
  } finally { mounted.unmount(); }
});
