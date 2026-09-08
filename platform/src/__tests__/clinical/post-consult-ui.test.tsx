import { mountAndFlush, setSelect, setValue, clickAsync, type Mounted } from '../components/clinical-notes/test-utils';
import type { EncounterDoc } from '@/lib/db-types';
import { newPostConsultHandoff } from '@/modules/post-consult';

const mockScope = { userId: 'nurse', role: 'nurse', hospitalId: 'hospital', orgId: 'org' };
const mockUser = { _id: 'nurse', name: 'Nurse Mary', role: 'nurse', isActive: true };
let mockEncounter: EncounterDoc;
let mockPlan = 'original';
let mounted: Mounted;
const mockSave = jest.fn();
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => mockScope }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: mockUser }) }));
jest.mock('@/lib/hooks/useUsers', () => ({ useUsers: () => ({ users: [mockUser, { _id: 'replacement', name: 'Nurse Sara', role: 'nurse', isActive: true }] }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/modules/post-consult/services/plan-service', () => ({ currentPlanRevision: async () => mockPlan }));
jest.mock('@/modules/post-consult/services/handoff-service', () => ({
  getHandoffQueue: async () => [mockEncounter], getHandoffEncounter: async () => mockEncounter,
  updateHandoff: (...args: unknown[]) => mockSave(...args), ensurePostConsultHandoff: jest.fn(),
}));
import { PostConsultPanel } from '@/modules/post-consult/client';

beforeEach(() => {
  mockPlan = 'original'; mockSave.mockClear(); mockSave.mockImplementation(async () => mockEncounter);
  mockEncounter = { _id: 'visit', _rev: '1-a', type: 'clinical_encounter', patientId: 'patient', patientName: 'Synthetic Patient', status: 'ready_for_clinic_checkout',
    postConsult: { ...newPostConsultHandoff(), ownerId: 'nurse', acceptedAt: new Date().toISOString(), reviewedPlan: 'original' } } as EncounterDoc;
});
afterEach(() => mounted?.unmount());
function button(name: string) {
  return Array.from(mounted.container.querySelectorAll('button')).find(el => el.textContent === name)!;
}

test('shows staff names and requires a recipient and reason for transfer', async () => {
  mounted = await mountAndFlush(<PostConsultPanel />);
  expect(mounted.container.textContent).toContain('Nurse Mary');
  const transfer = button('postConsult.transfer');
  expect(transfer.disabled).toBe(true);
  setSelect(mounted.container.querySelector<HTMLSelectElement>('.ehr-post-consult-transfer select')!, 'replacement');
  setValue(mounted.container.querySelector<HTMLTextAreaElement>('.ehr-post-consult-transfer textarea')!, 'Shift change');
  await clickAsync(transfer);
  expect(mockSave).toHaveBeenCalledWith('visit', '1-a', { type: 'transfer', ownerId: 'replacement', reason: 'Shift change' }, mockScope);
});

test('changed plan shows re-review action and hides task attestation inputs', async () => {
  mockPlan = 'changed';
  mounted = await mountAndFlush(<PostConsultPanel />);
  expect(mounted.container.textContent).toContain('postConsult.changedHelp');
  expect(mounted.container.textContent).not.toContain('postConsult.evidence');
  await clickAsync(button('postConsult.reopen'));
  expect(mockSave).toHaveBeenCalledWith('visit', '1-a', { type: 'reopen', reason: 'postConsult.changed' }, mockScope);
});

test('a transferred handoff requires acceptance before recording outcomes', async () => {
  mockEncounter.postConsult!.acceptedAt = undefined;
  mounted = await mountAndFlush(<PostConsultPanel />);
  expect(button('postConsult.accept').disabled).toBe(false);
  expect(mounted.container.textContent).not.toContain('postConsult.evidence');
});
