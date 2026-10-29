/**
 * The billing tab's activity table lists what its totals are summed from.
 * Orders and prescriptions post to the ledger without a charge document, so a
 * table built from charge/payment documents alone showed "SSP 3,500 billed"
 * over "No billing activity matches this view".
 */
import React from 'react';
import { mountAndFlush, qa, type Mounted } from '../clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => {
  const map = (jest.requireActual('@/lib/i18n/locales/en') as { default: Record<string, string> }).default;
  return { useTranslation: () => ({ t: (key: string) => map[key] ?? key }) };
});
const AUTH = { currentUser: { _id: 'u1', name: 'Cashier One', role: 'cashier', hospitalId: 'h1', orgId: 'o1' } };
const SCOPE = { orgId: 'o1' };
jest.mock('@/lib/context', () => ({ useAuth: () => AUTH }));
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => SCOPE }));
const TOAST = { showToast: jest.fn() };
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

let ledger: unknown[] = [];
let charges: unknown[] = [];
jest.mock('@/lib/services/ledger-service', () => ({ getPatientLedger: jest.fn(async () => ledger) }));
jest.mock('@/lib/services/payment-service', () => ({
  getPaymentsByPatient: jest.fn(async () => []),
  getChargesByPatient: jest.fn(async () => charges),
  getPaymentPlansByPatient: jest.fn(async () => []),
  getPatientInsurancePolicies: jest.fn(async () => []),
  getRefundsByPatient: jest.fn(async () => []),
}));

import BillingTab from '@/components/patients/BillingTab';
import type { PatientDoc } from '@/lib/db-types';

const patient = { _id: 'pat-1', firstName: 'Mary', surname: 'Akol', hospitalNumber: 'H-1' } as unknown as PatientDoc;

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; ledger = []; charges = []; });

const render = () => mountAndFlush(
  <BillingTab patient={patient} patientBalance={0} showPaymentPanel={false} showPlanWizard={false}
    setShowPaymentPanel={() => {}} setShowPlanWizard={() => {}} reloadPayments={() => {}} />,
);
const rows = () => qa<HTMLTableRowElement>(mounted!.container, '.tamam-table--activity tbody tr').map(r => r.textContent || '');

describe('BillingTab activity', () => {
  it('lists ledger charges that have no charge document', async () => {
    ledger = [
      { _id: 'le-1', type: 'ledger_entry', patientId: 'pat-1', entryType: 'charge', amount: 1500, currency: 'SSP', description: 'Malaria RDT', createdAt: '2026-10-29T05:50:00.000Z' },
      { _id: 'le-2', type: 'ledger_entry', patientId: 'pat-1', entryType: 'charge', amount: 2000, currency: 'SSP', description: 'Artemether-Lumefantrine', createdAt: '2026-10-29T05:52:00.000Z' },
    ];
    mounted = await render();
    const text = rows().join('\n');
    expect(text).toContain('Malaria RDT');
    expect(text).toContain('Artemether-Lumefantrine');
    expect(text).not.toContain('No billing activity');
  });

  it('fills a ledger row in from the charge it points at', async () => {
    charges = [{ _id: 'ch-1', type: 'charge', patientId: 'pat-1', description: 'Consultation', category: 'consultation', status: 'pending', billedAmount: 800, serviceDate: '2026-10-29' }];
    ledger = [{ _id: 'le-3', type: 'ledger_entry', patientId: 'pat-1', entryType: 'charge', amount: 800, currency: 'SSP', description: 'Consultation', referenceId: 'ch-1', referenceType: 'charge', createdAt: '2026-10-29T06:00:00.000Z' }];
    mounted = await render();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('consultation');
  });

  it('falls back to charge documents for an account with no ledger', async () => {
    charges = [{ _id: 'ch-2', type: 'charge', patientId: 'pat-1', description: 'Old registration fee', category: 'registration', status: 'paid', billedAmount: 200, serviceDate: '2026-01-02' }];
    mounted = await render();
    expect(rows().join('\n')).toContain('Old registration fee');
  });
});
