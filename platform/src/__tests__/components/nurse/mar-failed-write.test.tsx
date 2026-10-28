/**
 * A dose whose write fails must not stay ticked on the MAR. The optimistic
 * "given" state is rolled back and the nurse gets a message that says the
 * slot is still open — the old text promised a retry that never happened.
 */
import { act } from 'react';
import { mount } from '../clinical-notes/test-utils';
import { useMarEntries } from '@/components/nurse/shared';

const showToast = jest.fn();
const administer = jest.fn();
const voidAdministration = jest.fn();

jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast }) }));
jest.mock('@/lib/context', () => ({
  useAuth: () => ({ currentUser: { _id: 'nurse-1', username: 'nurse.stella', name: 'Nurse Stella' } }),
  useUi: () => ({}),
}));
const prescriptions = [{
  _id: 'rx-1', patientId: 'p-1', patientName: 'Mary Akol', medication: 'Amoxicillin', dose: '500 mg',
  route: 'oral', frequency: 'PRN', status: 'pending', createdAt: '2026-10-27T06:00:00.000Z', administrations: [],
}];
jest.mock('@/lib/hooks/usePrescriptions', () => ({
  usePrescriptions: () => ({ prescriptions, administer, voidAdministration }),
}));

let hook: ReturnType<typeof useMarEntries>;
function Probe() { hook = useMarEntries(); return null; }

beforeEach(() => { showToast.mockReset(); administer.mockReset(); voidAdministration.mockReset(); });

it('reopens the slot and keeps an error on screen when recording a dose fails', async () => {
  administer.mockRejectedValue(new Error('Document update conflict'));
  const { unmount } = mount(<Probe />);
  const entry = hook.marEntries[0];
  expect(entry.status).toBe('upcoming');
  let ok = true;
  await act(async () => { ok = await hook.recordEntry(entry); });
  expect(ok).toBe(false);
  expect(hook.marEntries[0].status).toBe('upcoming');
  expect(hook.marEntries[0].givenAt).toBeUndefined();
  expect(showToast).toHaveBeenCalledWith('nurse.medicationGivenFailedToast', 'error', { sticky: true });
  unmount();
});

it('keeps the dose recorded when undoing it fails', async () => {
  voidAdministration.mockRejectedValue(new Error('offline'));
  const { unmount } = mount(<Probe />);
  const given = { ...hook.marEntries[0], status: 'given' as const, administrationId: 'adm-1', givenAt: '2026-10-27T08:00:00.000Z' };
  act(() => hook.setMarEntries([given]));
  await act(async () => { await hook.undoAdministration(given, 'Charted on the wrong patient'); });
  expect(hook.marEntries[0].status).toBe('given');
  expect(hook.marEntries[0].administrationId).toBe('adm-1');
  expect(showToast).toHaveBeenCalledWith('nurse.medicationUndoFailedToast', 'error', { sticky: true });
  unmount();
});
