/**
 * Prescribing safety at the service layer.
 *
 * 1. Allergy check: `drug-interaction-service` has always shipped a
 *    class-aware structured allergy checker, but nothing called it — a doctor
 *    could prescribe amoxicillin to a patient with a recorded severe
 *    penicillin allergy and get no warning. `createPrescription` now runs it
 *    and returns the alerts alongside the interaction warnings.
 * 2. Duplicate check: same drug ordered twice (dose/form-insensitive) is
 *    reported so the second order doesn't silently stack.
 * 3. orgId inference: a prescription written without `orgId` was rejected by
 *    the CouchDB validator and invisible to `filterByScope` (silent data
 *    loss). Like `createLabResult` and `createReferral`, the org is now
 *    inferred from the facility when missing.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB, prescriptionsDB } from '@/lib/db';
import { assessPrescriptionSafety, createPrescription as createPrescriptionScoped } from '@/lib/services/prescription-service';

// Fixtures here are single-tenant; a system-wide scope reads every doc, so the
// tenant barrier is exercised by the dedicated cross-org suite instead.
const TEST_SCOPE = { role: 'super_admin' } as const;
const createPrescription = (data: Parameters<typeof createPrescriptionScoped>[0]) =>
  createPrescriptionScoped(data, TEST_SCOPE);

afterEach(async () => {
  await teardownTestDBs();
});

async function seedHospital() {
  await putDoc(hospitalsDB(), {
    _id: 'hosp-001',
    type: 'hospital',
    name: 'Juba Teaching Hospital',
    orgId: 'org-moh-ss',
  } as never);
}

async function seedPatient(structuredAllergies: unknown[] = []) {
  await putDoc(patientsDB(), {
    _id: 'pat-00001',
    type: 'patient',
    firstName: 'Nyakuma',
    surname: 'Deng',
    structuredAllergies,
    allergies: (structuredAllergies as Array<{ substance: string }>).map(a => a.substance),
    registrationHospital: 'hosp-001',
    orgId: 'org-moh-ss',
  } as never);
}

function rxInput(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'pat-00001',
    patientName: 'Nyakuma Deng',
    medication: 'Amoxicillin 500mg',
    dose: '500mg',
    route: 'oral',
    frequency: 'TDS for 5 days',
    duration: '5 days',
    prescribedBy: 'Dr. Wani',
    status: 'pending' as const,
    hospitalId: 'hosp-001',
    ...overrides,
  };
}

const SEVERE_PENICILLIN_ALLERGY = {
  id: 'alg-1',
  substance: 'Penicillin',
  criticality: 'severe',
  status: 'active',
  reaction: 'Anaphylaxis',
  recordedAt: '2026-01-01T00:00:00.000Z',
};

describe('createPrescription — allergy safety', () => {
  it('can identify a severe class allergy before an order is written', async () => {
    await seedHospital();
    await seedPatient([SEVERE_PENICILLIN_ALLERGY]);

    const assessment = await assessPrescriptionSafety('pat-00001', 'Amoxicillin 500mg', TEST_SCOPE);

    expect(assessment.allergyWarnings?.[0]).toMatchObject({
      allergy: 'Penicillin',
      reason: 'class',
      requiresOverride: true,
    });
    const clinicalOrders = (await prescriptionsDB().allDocs()).rows
      .filter(row => !row.id.startsWith('_design/'));
    expect(clinicalOrders).toHaveLength(0);
  });

  it('refuses a severe allergy override without a documented justification', async () => {
    await seedHospital();
    await seedPatient([SEVERE_PENICILLIN_ALLERGY]);

    await expect(createPrescription(rxInput() as never)).rejects.toMatchObject({
      name: 'ValidationError',
    });
    const clinicalOrders = (await prescriptionsDB().allDocs()).rows
      .filter(row => !row.id.startsWith('_design/'));
    expect(clinicalOrders).toHaveLength(0);
  });

  it('flags a class match against a recorded severe allergy and requires override', async () => {
    await seedHospital();
    await seedPatient([SEVERE_PENICILLIN_ALLERGY]);

    const result = await createPrescription(rxInput({
      medicationSafetyAcknowledgement: {
        reviewedBy: 'Dr. Wani',
        reason: 'No clinically suitable alternative is available today.',
      },
    }) as never);

    expect(result.allergyWarnings).toHaveLength(1);
    expect(result.allergyWarnings?.[0]).toMatchObject({
      medication: 'Amoxicillin 500mg',
      allergy: 'Penicillin',
      reason: 'class',
      criticality: 'severe',
      requiresOverride: true,
    });
    // The prescription is written only after the prescriber records why the
    // severe conflict is clinically justified.
    expect(result.prescription._id).toMatch(/^rx-/);
    expect(result.prescription.medicationSafety?.allergyWarnings[0]).toMatchObject({
      allergy: 'Penicillin',
      requiresOverride: true,
    });
    expect(result.prescription.medicationSafety?.acknowledgement).toMatchObject({
      reviewedBy: 'Dr. Wani',
      reason: 'No clinically suitable alternative is available today.',
    });
    expect(result.prescription.medicationSafety?.acknowledgement?.reviewedAt).toBeTruthy();
  });

  it('ignores inactive allergies and reports nothing for a clean patient', async () => {
    await seedHospital();
    await seedPatient([{ ...SEVERE_PENICILLIN_ALLERGY, status: 'inactive' }]);

    const result = await createPrescription(rxInput() as never);

    expect(result.allergyWarnings ?? []).toHaveLength(0);
  });

  it('still writes the prescription when the patient record cannot be loaded', async () => {
    await seedHospital();
    // No patient seeded at all.
    const result = await createPrescription(rxInput() as never);

    expect(result.prescription._id).toMatch(/^rx-/);
    expect(result.allergyWarnings ?? []).toHaveLength(0);
  });
});

describe('createPrescription — duplicate orders', () => {
  it('reports a duplicate when the same drug is already active, dose notwithstanding', async () => {
    await seedHospital();
    await seedPatient();

    await createPrescription(rxInput({ medication: 'Amoxicillin 250mg' }) as never);
    const second = await createPrescription(rxInput({ medication: 'Amoxicillin 500mg' }) as never);

    expect(second.duplicateWarnings).toEqual(['Amoxicillin 250mg']);
  });

  it('does not flag different drugs as duplicates', async () => {
    await seedHospital();
    await seedPatient();

    await createPrescription(rxInput({ medication: 'Paracetamol 500mg' }) as never);
    const second = await createPrescription(rxInput() as never);

    expect(second.duplicateWarnings ?? []).toHaveLength(0);
  });

  it('does not report an unrelated duplicate already present in the chart', async () => {
    await seedHospital();
    await seedPatient();

    await createPrescription(rxInput({ medication: 'Ferrous Sulfate 200mg' }) as never);
    await createPrescription(rxInput({ medication: 'Ferrous Sulfate 300mg' }) as never);

    const assessment = await assessPrescriptionSafety('pat-00001', 'Paracetamol 500mg', TEST_SCOPE);

    expect(assessment.duplicateWarnings ?? []).toHaveLength(0);
  });
});

describe('createPrescription — org scoping', () => {
  it('infers orgId from the facility when the caller omits it', async () => {
    await seedHospital();
    await seedPatient();

    const result = await createPrescription(rxInput() as never);

    expect(result.prescription.orgId).toBe('org-moh-ss');
  });

  it('keeps a caller-supplied orgId', async () => {
    await seedHospital();
    await seedPatient();

    const result = await createPrescription(rxInput({ orgId: 'org-explicit' }) as never);

    expect(result.prescription.orgId).toBe('org-explicit');
  });
});
