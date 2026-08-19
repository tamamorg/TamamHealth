import {
  createPatientRegistrationDraftId,
  dropPatientRegistrationDraft,
  isPatientRegistrationDraftId,
  loadPatientRegistrationDraft,
  normalizePatientRegistrationDraft,
  PATIENT_REGISTRATION_DRAFT_TTL_MS,
  savePatientRegistrationDraft,
  type PatientRegistrationDraft,
} from '@/lib/patient-registration-draft';
import { EMPTY_REGISTRATION_FORM } from '@/components/patients/registration/registration-form';
import { dropDraft, loadDraft, saveDraft } from '@/lib/draft-storage';

jest.mock('@/lib/draft-storage', () => ({
  saveDraft: jest.fn(),
  loadDraft: jest.fn(),
  dropDraft: jest.fn(),
}));

const draft: PatientRegistrationDraft = {
  version: 1,
  form: { ...EMPTY_REGISTRATION_FORM, firstName: 'Nyadol', surname: 'Deng' },
  additionalNok: [{ name: 'Bol', relationship: 'Sibling', phone: '+211912345678', address: 'Juba' }],
  fingerprints: [{ finger: 'right_index', template: 'sensitive-template', quality: 88, format: 'ISO_19794_2', driver: 'bridge' }],
  patientPhotoUrl: 'data:image/jpeg;base64,sensitive-photo',
  reviewMode: false,
};

describe('patient registration draft hand-off', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates an opaque, URL-safe identifier with no patient data', () => {
    const id = createPatientRegistrationDraftId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(id).not.toContain(draft.form.firstName);
  });

  it('stores the complete PHI payload through encrypted draft storage with a short TTL', async () => {
    const id = '0123456789abcdef0123456789abcdef';
    jest.mocked(loadDraft).mockResolvedValue(draft);
    expect(await savePatientRegistrationDraft(id, draft)).toBe(true);
    expect(saveDraft).toHaveBeenCalledWith(
      `patient-registration:${id}`,
      draft,
      PATIENT_REGISTRATION_DRAFT_TTL_MS,
    );
    expect(loadDraft).toHaveBeenCalledWith(`patient-registration:${id}`);
  });

  it('reports failure when encrypted storage cannot read back the hand-off', async () => {
    const id = '0123456789abcdef0123456789abcdef';
    jest.mocked(loadDraft).mockResolvedValue(null);
    await expect(savePatientRegistrationDraft(id, draft)).resolves.toBe(false);
  });

  it('hydrates a valid payload and removes it on completion or cancellation', async () => {
    const id = 'abcdef0123456789abcdef0123456789';
    jest.mocked(loadDraft).mockResolvedValue(draft);

    await expect(loadPatientRegistrationDraft(id)).resolves.toEqual(draft);
    await dropPatientRegistrationDraft(id);
    expect(dropDraft).toHaveBeenCalledWith(`patient-registration:${id}`);
  });

  it.each(['', '../patient', 'patient name', 'https://example.test', 'a'.repeat(31)])(
    'rejects unsafe draft identifier %p without touching storage',
    async id => {
      expect(isPatientRegistrationDraftId(id)).toBe(false);
      expect(await savePatientRegistrationDraft(id, draft)).toBe(false);
      await expect(loadPatientRegistrationDraft(id)).resolves.toBeNull();
      await dropPatientRegistrationDraft(id);
      expect(saveDraft).not.toHaveBeenCalled();
      expect(loadDraft).not.toHaveBeenCalled();
      expect(dropDraft).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed payloads and bounds extra contacts', () => {
    expect(normalizePatientRegistrationDraft({ version: 2, form: {} })).toBeNull();
    const normalized = normalizePatientRegistrationDraft({
      ...draft,
      additionalNok: Array.from({ length: 8 }, () => draft.additionalNok[0]),
      form: { ...draft.form, firstName: 42, payorCoverageType: 'malicious' },
    });
    expect(normalized?.additionalNok).toHaveLength(3);
    expect(normalized?.form.firstName).toBe('');
    expect(normalized?.form.payorCoverageType).toBe('out-of-pocket');
  });
});
