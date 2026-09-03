/**
 * PatientSBAR's "why this priority" explainability (KAN triage-ux item 11):
 * every structured triage danger sign used to be write-only — a nurse ticks
 * it, the chart shows only a RED badge. This renders the FULL component (the
 * same createRoot/act pattern used by modal-scrim.test.tsx and
 * boot-integrity-guard.test.tsx — no React Testing Library dependency in this
 * repo) against a fully-populated TriageDoc and asserts the read side
 * actually surfaces what produced the priority.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PatientSBAR from '@/components/patients/PatientSBAR';
import type { PatientDoc, TriageDoc } from '@/lib/db-types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const patient = {
  _id: 'patient-1',
  type: 'patient',
  firstName: 'Nyandeng',
  surname: 'Deng',
  gender: 'Female',
  hospitalNumber: 'HN-0001',
  dateOfBirth: '1998-03-01',
  allergies: [],
  chronicConditions: [],
} as unknown as PatientDoc;

const fullyPopulatedTriage = {
  _id: 'triage-1',
  type: 'triage',
  patientId: 'patient-1',
  patientName: 'Nyandeng Deng',
  airway: 'clear',
  breathing: 'distressed',
  circulation: 'normal',
  consciousness: 'alert',
  priority: 'RED',
  status: 'seen',
  assessmentSource: 'clinician',
  redCriteria: ['airway_breathing', 'shock_bleeding'],
  yellowCriteria: ['pallor_bleeding_fainting'],
  infectionRiskSigns: ['fever_rash'],
  isolationRequired: true,
  capillaryRefillSeconds: '4',
  immediateInterventions: 'Oxygen 4L via nasal cannula',
  preArrivalCare: 'IV fluids started by referring clinic',
  vitalUrgencyWarnings: [
    { field: 'oxygenSaturation', code: 'IITT_HIGH_RISK_SPO2', urgency: 'RED', message: 'Oxygen saturation 88% is high risk.' },
  ],
  vitalUrgencyOverridden: false,
  chiefComplaint: 'Difficulty breathing',
  notes: '[Priority raised to RED by nurse] Caregiver reports rapid deterioration overnight',
  triagedBy: 'nurse-1',
  triagedByName: 'Nurse Achol Bul',
  triagedAt: '2026-08-29T07:15:00.000Z',
  createdAt: '2026-08-29T07:15:00.000Z',
  updatedAt: '2026-08-29T07:15:00.000Z',
} as unknown as TriageDoc;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderSbar(triage: TriageDoc) {
  act(() => {
    root.render(
      <PatientSBAR
        patient={patient}
        records={[]}
        labs={[]}
        prescriptions={[]}
        triages={[triage]}
        problems={[]}
        latestShiftHandoff={null}
      />,
    );
  });
  return container.textContent || '';
}

describe('PatientSBAR — triage priority explainability', () => {
  it('renders nothing extra for a triage with no structured danger signs', () => {
    const plain = { ...fullyPopulatedTriage, redCriteria: [], yellowCriteria: [], infectionRiskSigns: [], isolationRequired: false, capillaryRefillSeconds: undefined, immediateInterventions: undefined, preArrivalCare: undefined, vitalUrgencyWarnings: undefined, notes: 'Nothing unusual.' } as unknown as TriageDoc;
    const text = renderSbar(plain);
    expect(text).not.toContain('Why this priority');
  });

  it('shows the ticked IITT red and yellow criteria by their full label, not their code', () => {
    const text = renderSbar(fullyPopulatedTriage);
    expect(text).toContain('Why this priority');
    expect(text).toContain('Stridor, respiratory distress or central cyanosis');
    expect(text).toContain('Capillary refill >3 seconds, weak/fast pulse or heavy bleeding');
    expect(text).toContain('Severe pallor, ongoing bleeding or recent fainting');
    // Raw codes must never leak to the reader.
    expect(text).not.toContain('airway_breathing');
    expect(text).not.toContain('shock_bleeding');
  });

  it('renders the isolation flag prominently', () => {
    const text = renderSbar(fullyPopulatedTriage);
    expect(text).toContain('ISOLATION');
  });

  it('shows capillary refill, immediate interventions and pre-arrival care', () => {
    const text = renderSbar(fullyPopulatedTriage);
    expect(text).toContain('4s');
    expect(text).toContain('Oxygen 4L via nasal cannula');
    expect(text).toContain('IV fluids started by referring clinic');
  });

  it('surfaces the vital-urgency safety warning message', () => {
    const text = renderSbar(fullyPopulatedTriage);
    expect(text).toContain('Oxygen saturation 88% is high risk.');
  });

  it('shows a manual priority raise and who recorded it', () => {
    const text = renderSbar(fullyPopulatedTriage);
    expect(text).toContain('Priority raised to RED by nurse');
    expect(text).toContain('Caregiver reports rapid deterioration overnight');
    expect(text).toContain('Nurse Achol Bul');
  });

  it('shows a downgrade override reason and who recorded it', () => {
    const overridden = {
      ...fullyPopulatedTriage,
      priority: 'GREEN',
      vitalUrgencyOverridden: true,
      vitalUrgencyRecommendation: 'YELLOW',
      vitalUrgencyOverrideReason: 'Reassessed after antipyretic; patient now stable',
      notes: 'Reassessed.',
    } as unknown as TriageDoc;
    const text = renderSbar(overridden);
    expect(text).toContain('Saved below the recommended YELLOW urgency');
    expect(text).toContain('Reassessed after antipyretic; patient now stable');
    expect(text).toContain('Nurse Achol Bul');
  });
});
