import type { ANCVisitDoc } from '@/lib/db-types';

export type AncRiskLevel = '' | ANCVisitDoc['riskLevel'];

export interface AncRegistrationForm {
  motherId: string;
  motherName: string;
  motherAge: number | '';
  gravida: number | '';
  parity: number | '';
  visitNumber: number;
  visitDate: string;
  gestationalAge: number | '';
  bloodPressure: string;
  weight: number | '';
  fundalHeight: number | '';
  fetalHeartRate: number | '';
  hemoglobin: number | '';
  urineProtein: string;
  bloodGroup: string;
  rhFactor: string;
  hivStatus: string;
  malariaTest: string;
  syphilisTest: string;
  ironFolateGiven: boolean | null;
  tetanusVaccine: boolean | null;
  iptpDose: number | '';
  riskFactors: string[];
  riskLevel: AncRiskLevel;
  birthPlanFacility: string;
  birthPlanTransport: string;
  birthPlanBloodDonor: string;
  nextVisitDate: string;
  notes: string;
}

/**
 * An initial form may contain workflow context, but never an unobserved
 * clinical fact. `Not tested` is an explicit absent state, not a negative
 * result; observations and classifications stay empty until reviewed.
 */
export function createAncRegistrationForm(visitDate: string): AncRegistrationForm {
  return {
    motherId: '', motherName: '', motherAge: '', gravida: '', parity: '',
    visitNumber: 1, visitDate, gestationalAge: '',
    bloodPressure: '', weight: '', fundalHeight: '', fetalHeartRate: '',
    hemoglobin: '', urineProtein: '', bloodGroup: '', rhFactor: '',
    hivStatus: 'Not tested', malariaTest: 'Not tested', syphilisTest: 'Not tested',
    ironFolateGiven: null, tetanusVaccine: null, iptpDose: '',
    riskFactors: [], riskLevel: '',
    birthPlanFacility: '', birthPlanTransport: '', birthPlanBloodDonor: '',
    nextVisitDate: '', notes: '',
  };
}

export interface AncPatientPrefill {
  patientId: string;
  patientName: string;
  age?: number;
}

/**
 * Prefill only confirmed, reviewable facts from the linked mother's current
 * pregnancy. A visit linked to a birth closes that pregnancy and must not seed
 * the next one. Visits more than 300 days old are treated as a prior episode.
 */
export function deriveAncPatientPrefill(
  current: AncRegistrationForm,
  patient: AncPatientPrefill,
  visits: ANCVisitDoc[],
): AncRegistrationForm {
  const selectedDate = Date.parse(`${current.visitDate}T00:00:00Z`);
  const eligible = visits
    .filter(visit =>
      (visit.patientId === patient.patientId || visit.motherId === patient.patientId) &&
      !visit.linkedBirthId &&
      Number.isFinite(Date.parse(`${visit.visitDate}T00:00:00Z`)) &&
      Date.parse(`${visit.visitDate}T00:00:00Z`) <= selectedDate &&
      selectedDate - Date.parse(`${visit.visitDate}T00:00:00Z`) <= 300 * 86_400_000
    )
    .sort((a, b) => Date.parse(b.visitDate) - Date.parse(a.visitDate));

  const latest = eligible[0];
  if (!latest) {
    return {
      ...current,
      motherId: patient.patientId,
      motherName: patient.patientName,
      motherAge: patient.age ?? '',
    };
  }

  const elapsedWeeks = Math.max(0, Math.floor((selectedDate - Date.parse(`${latest.visitDate}T00:00:00Z`)) / (7 * 86_400_000)));
  const estimatedGestationalAge = Math.min(44, latest.gestationalAge + elapsedWeeks);

  return {
    ...current,
    motherId: patient.patientId,
    motherName: patient.patientName,
    motherAge: patient.age ?? latest.motherAge,
    gravida: latest.gravida,
    parity: latest.parity,
    visitNumber: Math.max(...eligible.map(visit => visit.visitNumber)) + 1,
    gestationalAge: estimatedGestationalAge,
    bloodGroup: latest.bloodGroup && latest.bloodGroup !== 'Unknown' ? latest.bloodGroup : current.bloodGroup,
    rhFactor: latest.rhFactor && latest.rhFactor !== 'Unknown' ? latest.rhFactor : current.rhFactor,
  };
}

/** Required fields whose absence could make an ANC record misleading. */
export function missingAncRequiredFields(form: AncRegistrationForm): string[] {
  const missing: string[] = [];
  if (!form.motherName.trim()) missing.push('motherName');
  if (form.motherAge === '') missing.push('motherAge');
  if (form.gravida === '') missing.push('gravida');
  if (form.parity === '') missing.push('parity');
  if (form.gestationalAge === '') missing.push('gestationalAge');
  if (!form.urineProtein) missing.push('urineProtein');
  if (!form.bloodGroup) missing.push('bloodGroup');
  if (!form.rhFactor) missing.push('rhFactor');
  if (form.ironFolateGiven === null) missing.push('ironFolateGiven');
  if (form.tetanusVaccine === null) missing.push('tetanusVaccine');
  if (form.iptpDose === '') missing.push('iptpDose');
  if (!form.riskLevel) missing.push('riskLevel');
  return missing;
}
