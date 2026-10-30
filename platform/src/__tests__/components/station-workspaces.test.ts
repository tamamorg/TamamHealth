/**
 * The nutrition and radiology homes on the shared clinical workspace
 * (NutritionHomeView / RadiologyHomeView) and the chart forms they open.
 *
 * Both assemblers are pure combiners over already-scoped hook output, like
 * assembleNurseWorklist: this covers their own logic — which records make a
 * worklist row, which to-do list an entry lands in, and that every entry
 * opens the chart with the right form — never tenancy, which is upstream.
 */
import { assembleNutritionWorklist, screeningFormHref } from '@/components/dashboards/NutritionHomeView';
import { assembleRadiologyWorklist, imagingReportHref } from '@/components/dashboards/RadiologyHomeView';
import { allowedRoleFormPanels, railRoleFormPanels } from '@/components/ehr/chart/TamamChartShell';
import { screeningAgeLabel } from '@/components/ehr/chart/panels/NutritionScreeningPanel';
import type { LabResultDoc, NutritionScreeningDoc, PatientDoc } from '@/lib/db-types';
import type { NutritionSupplyDoc } from '@/lib/services/nutrition-supply-service';

const ME = { _id: 'user-nutr', name: 'Nyabol Jal' };

function screening(over: Partial<NutritionScreeningDoc>): NutritionScreeningDoc {
  return {
    _id: `ns-${Math.random().toString(36).slice(2)}`,
    type: 'nutrition_screening',
    patientName: 'Akech Deng Mawien',
    age: '2y',
    sex: 'F',
    muac: 12,
    edema: false,
    isAnc: false,
    status: 'MAM',
    screeningDate: '2026-10-29',
    createdAt: '2026-10-29T08:00:00.000Z',
    ...over,
  } as NutritionScreeningDoc;
}

function study(over: Partial<LabResultDoc>): LabResultDoc {
  return {
    _id: `lr-${Math.random().toString(36).slice(2)}`,
    type: 'lab_result',
    patientId: 'pat-1',
    patientName: 'Deng Mabior Garang',
    testName: 'X-Ray — Chest PA',
    specimen: 'Imaging',
    status: 'pending',
    critical: false,
    orderedBy: 'Dr. James Wani',
    orderedAt: '2026-10-29T07:00:00.000Z',
    completedAt: '',
    result: '',
    unit: '',
    referenceRange: '',
    abnormal: false,
    ...over,
  } as LabResultDoc;
}

const NUTRITION_LABELS = {
  samToTreat: 'SAM to treat', followUps: 'Follow-ups', supplyAlerts: 'Supply alerts',
  edema: 'oedema', muac: (v: number) => `MUAC ${v} cm`,
};

describe('assembleNutritionWorklist', () => {
  it('lists a patient by their LATEST screening only', () => {
    const { patients } = assembleNutritionWorklist({
      currentUser: ME,
      patients: [],
      // Newest first, as the hook returns them: recovered today, SAM before.
      screenings: [
        screening({ patientId: 'pat-1', status: 'Normal', muac: 14 }),
        screening({ patientId: 'pat-1', status: 'SAM', muac: 10.8 }),
        screening({ patientId: 'pat-2', status: 'SAM', muac: 11 }),
      ],
      supplies: [],
      labels: NUTRITION_LABELS,
    });
    expect(patients.map(p => p._id)).toEqual(['pat-2']);
    expect(patients[0].triagePriority).toBe('RED');
  });

  it('drops followed-up cases and unlinked screenings', () => {
    const { patients, outstanding } = assembleNutritionWorklist({
      currentUser: ME,
      patients: [],
      screenings: [
        screening({ patientId: 'pat-1', status: 'MAM', followUpAction: 'followed_up' }),
        screening({ status: 'SAM' }), // no chart to open
        screening({ patientId: 'pat-3', status: 'At Risk' }),
      ],
      supplies: [],
      labels: NUTRITION_LABELS,
    });
    expect(patients.map(p => p._id)).toEqual(['pat-3']);
    expect(outstanding[0]).toMatchObject({ label: 'SAM to treat', count: 0 });
    expect(outstanding[1]).toMatchObject({ label: 'Follow-ups', count: 1 });
  });

  it('opens every case in the chart with the screening form up', () => {
    const { outstanding } = assembleNutritionWorklist({
      currentUser: ME,
      patients: [],
      screenings: [screening({ patientId: 'pat 9', status: 'SAM', edema: true })],
      supplies: [],
      labels: NUTRITION_LABELS,
    });
    const [entry] = outstanding[0].entries ?? [];
    expect(entry.href).toBe('/patients/pat%209?form=nutrition-screening');
    expect(entry.href).toBe(screeningFormHref('pat 9'));
    expect(entry.subtitle).toContain('oedema');
    expect(outstanding[0].tone).toBe('danger');
  });

  it('raises low and critical stock as supply alerts', () => {
    const supplies = [
      { _id: 's1', name: 'RUTF', unit: 'sachets', currentLevel: 4, reorderLevel: 10 },
      { _id: 's2', name: 'F-75', unit: 'tins', currentLevel: 8, reorderLevel: 10 },
      { _id: 's3', name: 'Tapes', unit: 'tapes', currentLevel: 50, reorderLevel: 10 },
    ] as NutritionSupplyDoc[];
    const { outstanding } = assembleNutritionWorklist({
      currentUser: ME, patients: [], screenings: [], supplies, labels: NUTRITION_LABELS,
    });
    expect(outstanding[2]).toMatchObject({ count: 2, tone: 'danger', href: '/dashboard/nutrition/supplies' });
  });
});

const RADIOLOGY_LABELS = { toPerform: 'To perform', toReport: 'To report', urgent: 'Urgent', reportedToday: 'Reported today' };
const NOW = new Date('2026-10-29T12:00:00');

describe('assembleRadiologyWorklist', () => {
  it('gives one row per patient, urgent studies first, ignoring lab tests', () => {
    const { patients } = assembleRadiologyWorklist({
      currentUser: ME,
      patients: [{ _id: 'pat-2', firstName: 'Nyabol', surname: 'Koang', gender: 'Female' } as PatientDoc],
      results: [
        study({ patientId: 'pat-1', testName: 'Ultrasound — Abdomen' }),
        study({ patientId: 'pat-1', testName: 'X-Ray — Chest PA' }),
        study({ patientId: 'pat-2', testName: 'MRI — Brain', critical: true }),
        study({ patientId: 'pat-3', testName: 'Malaria RDT', specimen: 'Blood' }),
        study({ patientId: 'pat-4', status: 'completed' }),
      ],
      labels: RADIOLOGY_LABELS,
      now: NOW,
    });
    expect(patients.map(p => p._id)).toEqual(['pat-2', 'pat-1']);
    expect(patients[0]).toMatchObject({ triagePriority: 'RED', name: 'Nyabol Koang', ward: 'MRI — Brain' });
    expect(patients[1].ward).toMatch(/\+1$/);
  });

  it('sorts open studies into perform / report and opens the report form', () => {
    const { outstanding } = assembleRadiologyWorklist({
      currentUser: ME,
      patients: [],
      results: [
        study({ patientId: 'pat-1', status: 'pending' }),
        study({ patientId: 'pat-2', status: 'in_progress' }),
        study({ patientId: 'pat-3', status: 'completed', reportedAt: '2026-10-29T09:00:00' }),
        study({ patientId: 'pat-4', status: 'completed', reportedAt: '2026-10-20T09:00:00' }),
      ],
      labels: RADIOLOGY_LABELS,
      now: NOW,
    });
    const byLabel = Object.fromEntries(outstanding.map(o => [o.label, o]));
    expect(byLabel['To perform'].count).toBe(1);
    expect(byLabel['To report'].count).toBe(1);
    expect(byLabel['Reported today'].count).toBe(1);
    expect(byLabel['To perform'].entries?.[0].href).toBe(imagingReportHref('pat-1'));
  });
});

describe('chart role forms', () => {
  it('lets the nutritionist screen and the radiologist report, from the rail', () => {
    expect(railRoleFormPanels('nutritionist').map(p => p.id)).toEqual(['nutrition-screening']);
    expect(railRoleFormPanels('radiologist').map(p => p.id)).toEqual(['imaging-report']);
    expect(allowedRoleFormPanels('nutritionist', false).map(p => p.id)).toEqual(['nutrition-screening']);
    expect(allowedRoleFormPanels('radiologist', false).map(p => p.id)).toEqual(['imaging-report']);
  });

  it('lets clinical roles screen but never report imaging', () => {
    // Plus the Clinical forms that used to leave the chart (triage, ANC,
    // ward admission) — opened in the workspace, never on the rail.
    const chartForms = ['nutrition-screening', 'triage-form', 'anc-visit', 'ward-admission'];
    expect(allowedRoleFormPanels('doctor', true).map(p => p.id)).toEqual(chartForms);
    expect(allowedRoleFormPanels('nurse', true).map(p => p.id)).toEqual(chartForms);
    expect(railRoleFormPanels('doctor')).toEqual([]);
  });

  it('opens ward admission only for roles that may admit', () => {
    // Pharmacists and lab staff read charts but do not admit.
    expect(allowedRoleFormPanels('pharmacist', true).map(p => p.id)).not.toContain('ward-admission');
    expect(allowedRoleFormPanels('lab_tech', true).map(p => p.id)).not.toContain('ward-admission');
  });

  it('gives the lab its bench and the pharmacy its counter, and nobody else either', () => {
    expect(railRoleFormPanels('lab_tech').map(p => p.id)).toEqual(['lab-orders']);
    expect(railRoleFormPanels('pharmacist').map(p => p.id)).toEqual(['dispense']);
    expect(allowedRoleFormPanels('doctor', true).map(p => p.id)).not.toContain('dispense');
    expect(allowedRoleFormPanels('doctor', true).map(p => p.id)).not.toContain('lab-orders');
  });

  it('gives roles with neither nothing', () => {
    expect(allowedRoleFormPanels('front_desk', false)).toEqual([]);
    expect(allowedRoleFormPanels('cashier', false)).toEqual([]);
    expect(allowedRoleFormPanels(undefined, true)).toEqual([]);
  });
});

describe('screeningAgeLabel', () => {
  const now = new Date(2026, 9, 29);
  it('reads under-twos in months and older children in years', () => {
    expect(screeningAgeLabel({ dateOfBirth: '2025-04-29' }, now)).toBe('18m');
    expect(screeningAgeLabel({ dateOfBirth: '2025-04-30' }, now)).toBe('17m');
    expect(screeningAgeLabel({ dateOfBirth: '2023-01-15' }, now)).toBe('3y');
  });
  it('falls back to the estimated age', () => {
    expect(screeningAgeLabel({ estimatedAge: 28 }, now)).toBe('28y');
    expect(screeningAgeLabel({}, now)).toBe('');
  });
});
