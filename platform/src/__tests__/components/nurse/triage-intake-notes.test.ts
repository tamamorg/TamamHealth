import {
  composeTriageIntakeNotes,
  extractManualPriorityRaise,
  manualPriorityRaiseNeedsReason,
} from '@/components/nurse/triage-intake-notes';

describe('manualPriorityRaiseNeedsReason', () => {
  it('requires a reason once a priority has been raised', () => {
    expect(manualPriorityRaiseNeedsReason('RED', '')).toBe(true);
    expect(manualPriorityRaiseNeedsReason('RED', '   ')).toBe(true);
    expect(manualPriorityRaiseNeedsReason('YELLOW', '')).toBe(true);
  });

  it('is satisfied once real text is recorded', () => {
    expect(manualPriorityRaiseNeedsReason('RED', 'Caregiver reports rapid deterioration overnight')).toBe(false);
  });

  it('never blocks submission when no raise was requested', () => {
    expect(manualPriorityRaiseNeedsReason('', '')).toBe(false);
  });
});

describe('composeTriageIntakeNotes', () => {
  it('returns undefined when every light-touch field is empty', () => {
    expect(composeTriageIntakeNotes({
      baseNotes: '', currentMedications: '', chronicConditions: [], unmeasuredVitalReasons: {},
      manualPriorityRaise: '', manualUpgradeReason: '',
    })).toBeUndefined();
  });

  it('keeps the nurse\'s own notes first, untouched', () => {
    const notes = composeTriageIntakeNotes({
      baseNotes: 'Patient calm, oriented x3.', currentMedications: '', chronicConditions: [],
      unmeasuredVitalReasons: {}, manualPriorityRaise: '', manualUpgradeReason: '',
    });
    expect(notes).toBe('Patient calm, oriented x3.');
  });

  it('labels current medications and chronic conditions on their own lines', () => {
    const notes = composeTriageIntakeNotes({
      baseNotes: '', currentMedications: 'Metformin 500mg BD', chronicConditions: ['Diabetes', 'Hypertension'],
      unmeasuredVitalReasons: {}, manualPriorityRaise: '', manualUpgradeReason: '',
    });
    expect(notes).toContain('[Current medications] Metformin 500mg BD');
    expect(notes).toContain('[Chronic conditions] Diabetes, Hypertension');
  });

  it('summarizes why vitals were not measured, by field label and reason', () => {
    const notes = composeTriageIntakeNotes({
      baseNotes: '', currentMedications: '', chronicConditions: [],
      unmeasuredVitalReasons: { muac: 'equipment_unavailable', gcs: 'declined' },
      manualPriorityRaise: '', manualUpgradeReason: '',
    });
    expect(notes).toContain('[Vitals not measured]');
    expect(notes).toContain('MUAC: equipment unavailable');
    expect(notes).toContain('GCS: patient declined');
  });

  it('records a manual priority raise only when a reason is present', () => {
    const withoutReason = composeTriageIntakeNotes({
      baseNotes: '', currentMedications: '', chronicConditions: [], unmeasuredVitalReasons: {},
      manualPriorityRaise: 'RED', manualUpgradeReason: '   ',
    });
    expect(withoutReason).toBeUndefined();

    const withReason = composeTriageIntakeNotes({
      baseNotes: '', currentMedications: '', chronicConditions: [], unmeasuredVitalReasons: {},
      manualPriorityRaise: 'RED', manualUpgradeReason: 'Safeguarding concern raised by caregiver',
    });
    expect(withReason).toBe('[Priority raised to RED by nurse] Safeguarding concern raised by caregiver');
  });

  it('joins every populated line, in order, when several fields are used at once', () => {
    const notes = composeTriageIntakeNotes({
      baseNotes: 'Alert and cooperative.',
      currentMedications: 'ARVs',
      chronicConditions: ['HIV'],
      unmeasuredVitalReasons: { temperature: 'equipment_unavailable' },
      manualPriorityRaise: 'YELLOW',
      manualUpgradeReason: 'Vulnerable elderly patient living alone',
    });
    expect(notes).toBe([
      'Alert and cooperative.',
      '[Current medications] ARVs',
      '[Chronic conditions] HIV',
      '[Vitals not measured] Temperature: equipment unavailable',
      '[Priority raised to YELLOW by nurse] Vulnerable elderly patient living alone',
    ].join('\n'));
  });
});

describe('extractManualPriorityRaise', () => {
  it('returns null when there is no raise line', () => {
    expect(extractManualPriorityRaise(undefined)).toBeNull();
    expect(extractManualPriorityRaise('Ordinary clinical notes.')).toBeNull();
  });

  it('reads the priority and reason back out of a composed notes string', () => {
    const notes = composeTriageIntakeNotes({
      baseNotes: 'Patient anxious.', currentMedications: '', chronicConditions: [], unmeasuredVitalReasons: {},
      manualPriorityRaise: 'RED', manualUpgradeReason: 'Rapid deterioration reported by caregiver',
    });
    expect(extractManualPriorityRaise(notes)).toEqual({ priority: 'RED', reason: 'Rapid deterioration reported by caregiver' });
  });
});
