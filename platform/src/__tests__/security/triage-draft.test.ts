import {
  dropTriageDraft,
  loadTriageDraft,
  normalizeTriageDraft,
  saveTriageDraft,
  TRIAGE_DRAFT_TTL_MS,
  type TriageDraft,
} from '@/lib/triage-draft';
import { dropDraft, loadDraft, saveDraft } from '@/lib/draft-storage';

jest.mock('@/lib/draft-storage', () => ({
  saveDraft: jest.fn(),
  loadDraft: jest.fn(),
  dropDraft: jest.fn(),
}));

const PATIENT_ID = 'patient-abc123';

const draft: TriageDraft = {
  version: 1,
  patientId: PATIENT_ID,
  abcc: { airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'alert', priority: 'GREEN' },
  vitals: {
    temperature: '37.2', pulse: '82', respiratoryRate: '18', systolic: '118', diastolic: '76',
    oxygenSaturation: '98', weight: '61', height: '165', painScore: '2', bloodGlucose: '5.4', gcs: '15', muac: '24',
  },
  context: { modeOfArrival: 'walk-in', symptomDuration: '2 days', referralSource: '', knownAllergies: 'Penicillin' },
  complaint: 'Fever and cough',
  notes: 'Draft note',
  presentationCategory: 'medical',
  redCriteria: [],
  yellowCriteria: ['feeding_fluid_loss'],
  capillaryRefillSeconds: '2',
  pregnancyStatus: 'not_pregnant',
  gestationalAgeWeeks: '',
  injuryMechanism: '',
  infectionRiskSigns: [],
  isolationRequired: false,
  preArrivalCare: '',
  immediateInterventions: '',
  disposition: 'general_clinic',
  destinationClinic: 'OPD',
  assignedProviderId: '',
  handoffNote: '',
  overrideVitalUrgency: false,
  vitalUrgencyOverrideReason: '',
  currentMedications: 'Paracetamol',
  chronicConditions: ['HIV'],
  unmeasuredVitalReasons: { muac: 'equipment_unavailable' },
  manualPriorityRaise: '',
  manualUpgradeReason: '',
  editingTriageId: null,
  resumePendingTriageId: 'triage-pending-1',
  encounterId: 'encounter-1',
};

describe('triage draft recovery', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves the full draft through encrypted storage with the 24h triage TTL', async () => {
    await saveTriageDraft(PATIENT_ID, draft);
    expect(saveDraft).toHaveBeenCalledWith(`triage:${PATIENT_ID}`, draft, TRIAGE_DRAFT_TTL_MS);
    expect(TRIAGE_DRAFT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('round-trips a saved draft back through loadTriageDraft', async () => {
    jest.mocked(loadDraft).mockResolvedValue(draft);
    await expect(loadTriageDraft(PATIENT_ID)).resolves.toEqual(draft);
    expect(loadDraft).toHaveBeenCalledWith(`triage:${PATIENT_ID}`);
  });

  it('drops the draft under the same per-patient key', async () => {
    await dropTriageDraft(PATIENT_ID);
    expect(dropDraft).toHaveBeenCalledWith(`triage:${PATIENT_ID}`);
  });

  it('does nothing for an empty patient id', async () => {
    await saveTriageDraft('', draft);
    await dropTriageDraft('');
    expect(await loadTriageDraft('')).toBeNull();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(dropDraft).not.toHaveBeenCalled();
    expect(loadDraft).not.toHaveBeenCalled();
  });

  it('refuses a draft captured for a different patient — no cross-patient bleed', () => {
    expect(normalizeTriageDraft(draft, 'someone-else')).toBeNull();
  });

  it('rejects a malformed/tampered payload rather than trusting decrypted storage', () => {
    expect(normalizeTriageDraft(null, PATIENT_ID)).toBeNull();
    expect(normalizeTriageDraft({ version: 2, patientId: PATIENT_ID }, PATIENT_ID)).toBeNull();
    expect(normalizeTriageDraft('not an object', PATIENT_ID)).toBeNull();
  });

  it('coerces unknown enum-like values to safe defaults instead of passing them through', () => {
    const normalized = normalizeTriageDraft(
      {
        ...draft,
        abcc: { ...draft.abcc, airway: 'DROP TABLE' },
        pregnancyStatus: 'malicious',
        manualPriorityRaise: 'GREEN', // not a valid raise target
        redCriteria: ['unresponsive_convulsions', 42, null],
        unmeasuredVitalReasons: { muac: 'equipment_unavailable', pulse: 7 },
      },
      PATIENT_ID,
    );
    expect(normalized?.abcc.airway).toBe('');
    expect(normalized?.pregnancyStatus).toBe('unknown');
    expect(normalized?.manualPriorityRaise).toBe('');
    expect(normalized?.redCriteria).toEqual(['unresponsive_convulsions']);
    expect(normalized?.unmeasuredVitalReasons).toEqual({ muac: 'equipment_unavailable' });
  });

  it('normalizes a well-formed payload back to the exact draft shape', () => {
    expect(normalizeTriageDraft(draft, PATIENT_ID)).toEqual(draft);
  });
});
