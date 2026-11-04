/**
 * The patient chart's medication row actions open from the right, as sliders,
 * and Renew asks before it places a new order: it used to write one the moment
 * it was picked from the ⋮ menu.
 */
import { act } from 'react';
import { mount } from '../clinical-notes/test-utils';
import MedicationsSection from '@/components/ehr/chart/sections/MedicationsSection';
import { ConfirmLayoutProvider, ConfirmProvider } from '@/components/ConfirmDialog';

const rx = {
  _id: 'rx-1', patientId: 'p1', medication: 'Amoxicillin', dose: '500mg', route: 'oral',
  frequency: 'TID', duration: '5d', status: 'pending', orderStatus: 'prescribed',
  prescribedBy: 'Dr X', createdAt: '2026-10-01T00:00:00.000Z', orgId: 'org-1', hospitalId: 'hosp-1',
};
const createPrescription = jest.fn().mockResolvedValue({});
jest.mock('@/lib/services/prescription-service', () => ({
  assessPrescriptionSafety: jest.fn(async () => ({})),
  createPrescription: (...a: unknown[]) => createPrescription(...a),
  updatePrescription: jest.fn(async () => ({})),
}));
const dispensed = { ...rx, _id: 'rx-2', medication: 'Metformin', status: 'dispensed', createdAt: '2026-09-01T00:00:00.000Z', dispensedAt: '2026-09-02T00:00:00.000Z' };
jest.mock('@/lib/hooks/usePrescriptions', () => ({ usePrescriptions: () => ({ prescriptions: [rx, dispensed] }) }));
const mockScope = { orgId: 'org-1', hospitalId: 'hosp-1', role: 'doctor' };
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => mockScope }));
jest.mock('@/lib/hooks/useHistoryEntries', () => ({ useHistoryEntries: () => ({ entries: [], error: null, markInError: jest.fn() }) }));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ehr/chart/sections/ReportedMedications', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/patient-handover/PrescriptionCopyDialog', () => ({ __esModule: true, default: () => null }));
// The ⋮ menu's own popover is not what is under test: each action is a button.
jest.mock('@/components/RowActionsMenu', () => ({
  __esModule: true,
  default: ({ actions }: { actions: { key: string; label: string; onClick: () => void }[] }) => (
    <>{actions.map(a => <button key={a.key} type="button" data-action={a.key} onClick={a.onClick}>{a.label}</button>)}</>
  ),
}));

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

afterEach(() => { document.body.innerHTML = ''; createPrescription.mockClear(); });

async function chooseRenew() {
  const m = mount(
    <ConfirmProvider>
      <ConfirmLayoutProvider layout="slider">
        <MedicationsSection patientId="p1" patientName="Mary" canPrescribe onAdd={() => undefined} currentUser={{ _id: 'u1', name: 'Dr X' }} />
      </ConfirmLayoutProvider>
    </ConfirmProvider>,
  );
  await tick();
  act(() => document.body.querySelector<HTMLButtonElement>('[data-action="renew"]')!.click());
  await tick();
  return m;
}

const question = () => document.body.querySelector<HTMLElement>('[aria-labelledby="confirm-dialog-title"]');

describe('chart medication actions', () => {
  it('Renew asks first, in a slider, and writes nothing when cancelled', async () => {
    const m = await chooseRenew();
    expect(question()?.classList.contains('tm-slider')).toBe(true);
    expect(question()?.textContent).toContain('chart.medicationRenewTitle');
    act(() => question()!.querySelector<HTMLButtonElement>('.btn-secondary')!.click());
    await tick();
    expect(createPrescription).not.toHaveBeenCalled();
    m.unmount();
  });

  it('Renew places one order once confirmed', async () => {
    const m = await chooseRenew();
    act(() => question()!.querySelector<HTMLButtonElement>('.btn-primary')!.click());
    await tick(); await tick();
    expect(createPrescription).toHaveBeenCalledTimes(1);
    expect(createPrescription.mock.calls[0][0]).toMatchObject({ medication: 'Amoxicillin', status: 'pending' });
    m.unmount();
  });

  it('Discontinue asks for its reason in a slider', async () => {
    const m = mount(
      <ConfirmProvider>
        <ConfirmLayoutProvider layout="slider">
          <MedicationsSection patientId="p1" patientName="Mary" canPrescribe onAdd={() => undefined} />
        </ConfirmLayoutProvider>
      </ConfirmProvider>,
    );
    await tick();
    act(() => document.body.querySelector<HTMLButtonElement>('[data-action="stop"]')!.click());
    await tick();
    expect(question()?.classList.contains('tm-slider')).toBe(true);
    expect(question()?.querySelector('#confirm-dialog-reason')).not.toBeNull();
    m.unmount();
  });

  it('offers View report only for a prescription that was dispensed, and opens that one', async () => {
    const onViewReport = jest.fn();
    const m = mount(
      <ConfirmProvider>
        <MedicationsSection patientId="p1" patientName="Mary" canPrescribe onAdd={() => undefined} onSelect={() => undefined} onViewReport={onViewReport} />
      </ConfirmProvider>,
    );
    await tick();
    const reports = document.body.querySelectorAll<HTMLButtonElement>('[data-action="report"]');
    expect(reports).toHaveLength(1);
    act(() => reports[0].click());
    expect(onViewReport).toHaveBeenCalledWith('rx-2');
    m.unmount();
  });
});
