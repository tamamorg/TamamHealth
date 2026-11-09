/**
 * "No wards with free beds" must mean none, not "not loaded yet". The admit
 * form opens before useWards has read the ward and bed documents; raising the
 * warning on that first empty list left a false notice on screen for a facility
 * that had free beds.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let wardsState: { wards: unknown[]; beds: unknown[]; loading: boolean };

jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/components/overlay/NoticeToast', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <p data-notice>{children}</p> }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: { _id: 'u1', name: 'N', hospitalId: 'hosp-002' } }) }));
jest.mock('@/lib/hooks/usePatients', () => ({ usePatients: () => ({ patients: [] }) }));
jest.mock('@/lib/hooks/useWards', () => ({ useWards: () => ({ ...wardsState, admit: jest.fn() }) }));
jest.mock('@/lib/settings/SettingsProvider', () => ({ useSettings: () => ({ roomClasses: [] }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('@/components/overlay/FormSlider', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/forms/O3Form', () => ({
  __esModule: true,
  default: ({ notice }: { notice: React.ReactNode }) => <div>{notice}</div>,
  o3MissingRequired: () => [],
}));
jest.mock('@/components/CodedSearchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ehr/chart/panels/start-visit-panel.css', () => ({}), { virtual: true });

import WardAdmitForm from '@/components/wards/WardAdmitForm';

describe('WardAdmitForm no-wards notice', () => {
  it('stays quiet while wards and beds are still loading', () => {
    wardsState = { wards: [], beds: [], loading: true };
    const html = renderToStaticMarkup(<WardAdmitForm layout="workspace" onClose={() => {}} />);
    expect(html).not.toContain('ward.noWardsAvailable');
  });

  it('warns once loading finished with no admittable ward', () => {
    wardsState = { wards: [], beds: [], loading: false };
    const html = renderToStaticMarkup(<WardAdmitForm layout="workspace" onClose={() => {}} />);
    expect(html).toContain('ward.noWardsAvailable');
  });
});
