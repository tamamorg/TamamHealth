/**
 * The nurse review under the patient's notes (NurseReviewPanel), which replaced
 * the "Post-consultation nursing" block in the Care plan tab (2026-11-06): the
 * four review items with a one-line record each, nothing else on screen. The
 * handoff record and its checkout gate are unchanged.
 */
import { mountAndFlush, setValue, clickAsync, type Mounted } from '../components/clinical-notes/test-utils';
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
jest.mock('@/lib/hooks/useUsers', () => ({ useUsers: () => ({ users: [mockUser, { _id: 'other', name: 'Nurse Sara', role: 'nurse', isActive: true }] }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/modules/post-consult/services/plan-service', () => ({ currentPlanRevision: async () => mockPlan }));
jest.mock('@/modules/post-consult/services/handoff-service', () => ({
  getHandoffQueue: async () => [mockEncounter],
  updateHandoff: (...args: unknown[]) => mockSave(...args),
}));
import { NurseReviewPanel } from '@/modules/post-consult/client';

beforeEach(() => {
  mockPlan = 'original'; mockSave.mockClear();
  let rev = 1;
  mockSave.mockImplementation(async () => ({ ...mockEncounter, _rev: `${++rev}-x` }));
  mockEncounter = { _id: 'visit', _rev: '1-a', type: 'clinical_encounter', patientId: 'patient', patientName: 'Synthetic Patient', status: 'ready_for_clinic_checkout',
    postConsult: { ...newPostConsultHandoff(), reviewedPlan: 'original' } } as EncounterDoc;
});
afterEach(() => mounted?.unmount());
const buttons = (name: string) => Array.from(mounted.container.querySelectorAll('button')).filter(el => el.textContent === name);

test('renders nothing when the patient has no nurse review', async () => {
  delete mockEncounter.postConsult;
  mounted = await mountAndFlush(<NurseReviewPanel patientId="patient" />);
  expect(mounted.container.querySelector('.ehr-nurse-review')).toBeNull();
});

test("shows only this patient's review", async () => {
  mounted = await mountAndFlush(<NurseReviewPanel patientId="another-patient" />);
  expect(mounted.container.querySelector('.ehr-nurse-review')).toBeNull();
});

test('lists the four review items and none of the old handoff controls', async () => {
  mounted = await mountAndFlush(<NurseReviewPanel patientId="patient" />);
  const text = mounted.container.textContent || '';
  for (const kind of ['education', 'treatments', 'investigations', 'followup']) expect(text).toContain(`postConsult.task.${kind}`);
  expect(text).not.toContain('postConsult.transfer');
  expect(text).not.toContain('postConsult.accept');
  expect(text).not.toContain('postConsult.link.');
});

test('the first review takes the handoff, then records the item', async () => {
  mounted = await mountAndFlush(<NurseReviewPanel patientId="patient" />);
  setValue(mounted.container.querySelector<HTMLInputElement>('.ehr-nurse-review-entry input')!, 'Explained doses to the mother');
  await clickAsync(buttons('postConsult.markReviewed')[0]);
  expect(mockSave).toHaveBeenNthCalledWith(1, 'visit', '1-a', { type: 'accept' }, mockScope);
  expect(mockSave).toHaveBeenNthCalledWith(2, 'visit', '2-x', { type: 'task', kind: 'education', status: 'done', note: 'Explained doses to the mother' }, mockScope);
});

test("another nurse's review is read-only here", async () => {
  mockEncounter.postConsult = { ...mockEncounter.postConsult!, ownerId: 'other', acceptedAt: new Date().toISOString() };
  mounted = await mountAndFlush(<NurseReviewPanel patientId="patient" />);
  expect(mounted.container.textContent).toContain('Nurse Sara');
  expect(buttons('postConsult.markReviewed')).toHaveLength(0);
});

test('a changed plan asks for a fresh review instead of recording', async () => {
  mockEncounter.postConsult = { ...mockEncounter.postConsult!, ownerId: 'nurse', acceptedAt: new Date().toISOString() };
  mockEncounter.postConsult.tasks[0] = { ...mockEncounter.postConsult.tasks[0], status: 'done', note: 'x', recordedBy: 'nurse', recordedAt: new Date().toISOString() };
  mockPlan = 'changed';
  mounted = await mountAndFlush(<NurseReviewPanel patientId="patient" />);
  expect(mounted.container.textContent).toContain('postConsult.changed');
  expect(buttons('postConsult.markReviewed')).toHaveLength(0);
  await clickAsync(buttons('postConsult.reopen')[0]);
  expect(mockSave).toHaveBeenCalledWith('visit', '1-a', { type: 'reopen', reason: 'postConsult.changed' }, mockScope);
});
