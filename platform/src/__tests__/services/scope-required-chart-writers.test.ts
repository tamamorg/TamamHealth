/**
 * The embedded-list chart writers (allergies, care alerts, directives,
 * screenings) and nutrition screenings take a REQUIRED DataScope and check the
 * existing doc with filterByScope BEFORE mutating. Another org's scope gets
 * `null` (indistinguishable from "no such patient") and the chart is untouched.
 *
 * Prescription safety likewise needs a scope. With another org's scope the
 * patient's allergies are unreadable, and the assessment must say "unknown"
 * (`allergyCheckUnavailable: true`), never a bare "no allergy warnings" that
 * reads as safe.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB, nutritionScreeningsDB } from '@/lib/db';
import { addAllergy, updateAllergy, removeAllergy, getActiveAllergies } from '@/lib/services/allergy-service';
import { addCareAlert, resolveCareAlert } from '@/lib/services/care-alert-service';
import { addDirective, updateDirective, signDirective, removeDirective } from '@/lib/services/directive-service';
import { addScreening, completeScreening, declineScreening, removeScreening } from '@/lib/services/screening-service';
import { updateNutritionScreening } from '@/lib/services/nutrition-screening-service';
import { assessPrescriptionSafety } from '@/lib/services/prescription-service';
import type { DataScope } from '@/lib/services/data-scope';

type Role = DataScope['role'];
const A: DataScope = { orgId: 'org-a', hospitalId: 'h-a', role: 'clinician' as Role };
const B: DataScope = { orgId: 'org-b', hospitalId: 'h-b', role: 'clinician' as Role };
const NO_ORG: DataScope = { role: 'clinician' as Role };

const PID = 'pat-a-1';

async function seedPatient() {
  await putDoc(patientsDB(), {
    _id: PID, type: 'patient', orgId: 'org-a', hospitalId: 'h-a', firstName: 'Awut', surname: 'Deng',
    gender: 'Female', dateOfBirth: '1990-01-01', hospitalNumber: 'A-1', registrationHospital: 'h-a',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    structuredAllergies: [{
      id: 'al-1', substance: 'Penicillin', classification: 'drug', criticality: 'high', status: 'active',
      recordedAt: '2026-10-01T00:00:00.000Z',
    }],
    careAlerts: [{
      id: 'ca-1', category: 'clinical_risk', message: 'Fall risk', priority: 'high', status: 'active',
      recordedAt: '2026-10-01T00:00:00.000Z',
    }],
    directives: [{
      id: 'dir-1', type: 'advance_directive', description: 'DNR', status: 'active', recordedAt: '2026-10-01T00:00:00.000Z',
    }],
    screenings: [{
      id: 'sc-1', type: 'HIV test', status: 'due', dueDate: '2026-10-20', recordedAt: '2026-10-01T00:00:00.000Z',
    }],
  } as never);
}

async function stored() {
  return (await patientsDB().get(PID)) as unknown as {
    _rev: string;
    structuredAllergies: { id: string; status: string }[];
    careAlerts: { id: string; status: string }[];
    directives: { id: string; status: string; signature?: unknown }[];
    screenings: { id: string; status: string }[];
  };
}

beforeEach(seedPatient);
afterEach(async () => { await teardownTestDBs(); });

describe('chart writers refuse another org', () => {
  test.each([['org B', B], ['no org', NO_ORG]] as const)('allergy writers: %s', async (_n, scope) => {
    const before = await stored();
    expect(await addAllergy(PID, scope, { substance: 'Sulfa' })).toBeNull();
    expect(await updateAllergy(PID, scope, 'al-1', { status: 'inactive' })).toBeNull();
    expect(await removeAllergy(PID, scope, 'al-1', 'wrong chart')).toBeNull();
    const after = await stored();
    expect(after._rev).toBe(before._rev);
    expect(after.structuredAllergies).toHaveLength(1);
    expect(after.structuredAllergies[0].status).toBe('active');
  });

  test.each([['org B', B], ['no org', NO_ORG]] as const)('care alert writers: %s', async (_n, scope) => {
    const before = await stored();
    expect(await addCareAlert(PID, scope, { category: 'clinical_risk', message: 'x' })).toBeNull();
    expect(await resolveCareAlert(PID, scope, 'ca-1', 'cleared')).toBeNull();
    const after = await stored();
    expect(after._rev).toBe(before._rev);
    expect(after.careAlerts[0].status).toBe('active');
  });

  test.each([['org B', B], ['no org', NO_ORG]] as const)('directive writers: %s', async (_n, scope) => {
    const before = await stored();
    expect(await addDirective(PID, scope, { type: 'advance_directive', description: 'x' })).toBeNull();
    expect(await updateDirective(PID, scope, 'dir-1', { description: 'changed' })).toBeNull();
    expect(await signDirective(PID, scope, 'dir-1', { name: 'Mallory', signedBy: 'patient' })).toBeNull();
    expect(await removeDirective(PID, scope, 'dir-1', 'revoked by outsider')).toBeNull();
    const after = await stored();
    expect(after._rev).toBe(before._rev);
    expect(after.directives[0].status).toBe('active');
    expect(after.directives[0].signature).toBeUndefined();
  });

  test.each([['org B', B], ['no org', NO_ORG]] as const)('screening writers: %s', async (_n, scope) => {
    const before = await stored();
    expect(await addScreening(PID, scope, { type: 'Cervical cancer (VIA)' })).toBeNull();
    expect(await completeScreening(PID, scope, 'sc-1')).toBeNull();
    expect(await declineScreening(PID, scope, 'sc-1', 'no')).toBeNull();
    expect(await removeScreening(PID, scope, 'sc-1')).toBeNull();
    const after = await stored();
    expect(after._rev).toBe(before._rev);
    expect(after.screenings).toHaveLength(1);
    expect(after.screenings[0].status).toBe('due');
  });

  test('the owning org still writes (the scope check is not a blanket refusal)', async () => {
    const list = await addAllergy(PID, A, { substance: 'Sulfa' });
    expect(list?.map(a => a.substance)).toEqual(['Penicillin', 'Sulfa']);
    expect(await resolveCareAlert(PID, A, 'ca-1', 'cleared')).toEqual([expect.objectContaining({ status: 'resolved' })]);
    expect(await completeScreening(PID, A, 'sc-1', '2026-10-17')).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(await removeDirective(PID, A, 'dir-1', 'patient request')).toEqual([expect.objectContaining({ status: 'revoked' })]);
  });
});

describe('nutrition screening update', () => {
  beforeEach(async () => {
    await putDoc(nutritionScreeningsDB(), {
      _id: 'nscr-1', type: 'nutrition_screening', orgId: 'org-a', hospitalId: 'h-a', patientName: 'Awut Deng',
      muac: 10, edema: false, isAnc: false, status: 'SAM', followUpAction: 'needed',
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    } as never);
  });
  test('another org cannot update; the owner can', async () => {
    expect(await updateNutritionScreening('nscr-1', B, { followUpAction: 'referred' as never })).toBeNull();
    expect(await updateNutritionScreening('nscr-1', NO_ORG, { notes: 'x' })).toBeNull();
    const doc = (await nutritionScreeningsDB().get('nscr-1')) as unknown as { followUpAction: string; notes?: string };
    expect(doc.followUpAction).toBe('needed');
    expect(doc.notes).toBeUndefined();
    expect(await updateNutritionScreening('nscr-1', A, { notes: 'seen' })).toMatchObject({ notes: 'seen' });
  });
});

describe('prescription safety is scoped and fails safe', () => {
  test('in scope the recorded allergy is found', async () => {
    const result = await assessPrescriptionSafety(PID, 'Amoxicillin 500mg', A);
    expect(result.allergyCheckUnavailable).toBe(false);
    expect(result.allergyWarnings?.length).toBeGreaterThan(0);
  });

  test('another org\'s scope sees no allergies and reports the check as unavailable, not as clear', async () => {
    expect(await getActiveAllergies(PID, B)).toEqual([]);
    const result = await assessPrescriptionSafety(PID, 'Amoxicillin 500mg', B);
    expect(result.allergyWarnings).toBeNull();
    expect(result.allergyCheckUnavailable).toBe(true);
    const noOrg = await assessPrescriptionSafety(PID, 'Amoxicillin 500mg', NO_ORG);
    expect(noOrg.allergyCheckUnavailable).toBe(true);
  });

  test('an unknown patient is likewise unavailable rather than clear', async () => {
    const result = await assessPrescriptionSafety('pat-missing', 'Amoxicillin 500mg', A);
    expect(result.allergyCheckUnavailable).toBe(true);
  });
});
