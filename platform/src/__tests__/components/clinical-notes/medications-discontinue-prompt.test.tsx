/**
 * Patient safety: cancelling the "Reason for discontinuing" prompt must NOT
 * discontinue the medication. Confirming writes exactly once.
 */
import { act } from 'react';
import { mount, setValue } from './test-utils';
import MedicationsModal from '@/components/clinical-notes/MedicationsModal';
import { ConfirmProvider } from '@/components/ConfirmDialog';

const updatePrescription = jest.fn().mockResolvedValue({});
const rx = {
  _id: 'rx-1', patientId: 'p1', medication: 'Amoxicillin', dose: '500mg', route: 'oral',
  frequency: 'TID', duration: '5d', status: 'pending', orderStatus: 'prescribed',
  prescribedBy: 'Dr X', createdAt: '2026-10-01T00:00:00.000Z',
};

jest.mock('@/lib/services/prescription-service', () => ({
  getPrescriptionsByPatient: jest.fn(async () => [rx]),
  updatePrescription: (...a: unknown[]) => updatePrescription(...a),
  createPrescription: jest.fn(),
}));
jest.mock('@/lib/services/patient-service', () => ({
  getPatientById: jest.fn(async () => ({ _id: 'p1' })),
  updatePatient: jest.fn(),
}));
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => undefined }));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/clinical-notes/prescribe/PrescribeModal', () => ({ __esModule: true, default: () => null }));

afterEach(() => { document.body.innerHTML = ''; updatePrescription.mockClear(); });

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function openPrompt() {
  const m = mount(
    <ConfirmProvider>
      <MedicationsModal patientId="p1" patientName="Mary" currentUser={{ _id: 'u1', name: 'Dr X' }} onClose={() => undefined} />
    </ConfirmProvider>,
  );
  await tick(); await tick();
  const row = document.body.querySelector<HTMLElement>('[role="option"]')!;
  act(() => row.click());
  const discontinue = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.cn-meds-footer button'))
    .find(b => b.textContent === 'Discontinue')!;
  act(() => discontinue.click());
  await tick();
  return m;
}

const confirmDialog = () => document.body.querySelector<HTMLElement>('.confirm-dialog, [aria-labelledby="confirm-dialog-title"]')!;

describe('MedicationsModal discontinue', () => {
  it('writes nothing when the reason prompt is cancelled', async () => {
    const m = await openPrompt();
    const dialog = confirmDialog();
    expect(dialog).not.toBeNull();
    act(() => dialog.querySelector<HTMLButtonElement>('.btn-secondary')!.click());
    await tick();
    expect(updatePrescription).not.toHaveBeenCalled();
    m.unmount();
  });

  it('writes exactly once, with the typed reason, on confirm', async () => {
    const m = await openPrompt();
    const dialog = confirmDialog();
    setValue(dialog.querySelector<HTMLTextAreaElement>('#confirm-dialog-reason')!, 'Adverse reaction');
    act(() => dialog.querySelector<HTMLButtonElement>('.btn-primary')!.click());
    await tick(); await tick();
    expect(updatePrescription).toHaveBeenCalledTimes(1);
    expect(updatePrescription.mock.calls[0][0]).toBe('rx-1');
    expect(updatePrescription.mock.calls[0][1]).toMatchObject({ status: 'discontinued', stoppedReason: 'Adverse reaction' });
    m.unmount();
  });
});
