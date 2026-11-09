/**
 * Re-opening a saved triage under React StrictMode (what `next dev` runs).
 *
 * The form resolves a patient's active triage once: a pending clerical
 * placeholder is prefilled, a 'seen' one is loaded for correction. The one-shot
 * ref was spent before StrictMode's simulated unmount cancelled the lookup, so
 * the re-run saw "already checked" and nothing was ever loaded: the chief
 * complaint stayed blank and a saved triage re-opened as a blank NEW form,
 * whose save failed with "already has an active triage". Production does not
 * double-run effects, which is why it only showed in dev.
 */
import React, { StrictMode, act } from 'react';

const mockScope = { role: 'triage_nurse', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
const mockUser = { _id: 'user-1', name: 'Nurse Ayen', role: 'triage_nurse', hospitalId: 'hosp-001', orgId: 'org-moh-ss' };
const mockActive = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: mockUser }) }));
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => mockScope }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/settings/SettingsProvider', () => ({ useSettings: () => ({ departments: ['General Medicine'] }) }));
jest.mock('@/lib/hooks/usePatients', () => ({ usePatients: () => ({ patients: [] }) }));
jest.mock('@/lib/hooks/useUsers', () => ({ useUsers: () => ({ users: [] }) }));
jest.mock('@/lib/hooks/useANC', () => ({ useANC: () => ({ visits: [] }) }));
jest.mock('@/lib/hooks/useTriage', () => ({ useTriage: () => ({ triages: [], create: jest.fn(), update: jest.fn() }) }));
jest.mock('@/lib/hooks/useAppointments', () => ({ useAppointments: () => ({ appointments: [] }) }));
jest.mock('@/lib/hooks/useHistoryEntries', () => ({ useHistoryEntries: () => ({ entries: [], markInError: jest.fn(), stop: jest.fn() }) }));
jest.mock('@/lib/hooks/usePermissions', () => ({ usePermissions: () => ({ canRecordHistory: true }) }));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => jest.fn() }));
jest.mock('@/lib/triage-draft', () => ({
  loadTriageDraft: jest.fn(async () => null),
  saveTriageDraft: jest.fn(async () => undefined),
  dropTriageDraft: jest.fn(async () => undefined),
}));
jest.mock('@/lib/services/triage-service', () => ({
  findActiveTriageForPatient: (...args: unknown[]) => mockActive(...args),
}));

import { useTriageForm } from '@/components/nurse/triage/useTriageForm';
import { flush } from '../clinical-notes/test-utils';
import { createRoot } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATIENT = { _id: 'pat-1', firstName: 'Ayen', surname: 'Test', dateOfBirth: '1990-01-01', gender: 'Female' };

function Probe({ onState }: { onState: (s: { complaint: string; editing: string | null }) => void }) {
  const f = useTriageForm({ lockedPatientId: 'pat-1', lockedPatient: PATIENT as never });
  onState({ complaint: f.triageComplaint, editing: f.editingTriageId });
  return null;
}

async function renderStrict() {
  let latest = { complaint: '', editing: null as string | null };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<StrictMode><Probe onState={s => { latest = s; }} /></StrictMode>);
  });
  await act(async () => { await flush(); await new Promise(r => setTimeout(r, 0)); });
  await act(async () => { await flush(); });
  const out = () => latest;
  return { out, unmount: () => act(() => { root.unmount(); }) };
}

describe('useTriageForm one-shot lookup under StrictMode', () => {
  beforeEach(() => mockActive.mockReset());

  it('loads a saved (seen) triage for correction instead of a blank new form', async () => {
    mockActive.mockResolvedValue({
      _id: 'triage-1', patientId: 'pat-1', status: 'seen', chiefComplaint: 'Fever for three days',
      airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'alert',
      triagedAt: new Date().toISOString(),
    });
    const view = await renderStrict();
    expect(view.out().editing).toBe('triage-1');
    expect(view.out().complaint).toBe('Fever for three days');
    view.unmount();
  });

  it('prefills the complaint from a pending check-in placeholder', async () => {
    mockActive.mockResolvedValue({
      _id: 'triage-2', patientId: 'pat-1', status: 'pending', chiefComplaint: 'Cough', triagedAt: new Date().toISOString(),
    });
    const view = await renderStrict();
    expect(view.out().editing).toBeNull();
    expect(view.out().complaint).toBe('Cough');
    view.unmount();
  });
});
