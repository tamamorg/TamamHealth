/**
 * The safety tiers: a severe or unknown allergy and a contraindicated
 * interaction need a written reason at prescribing; an allergy nobody answered
 * at prescribing stops the handover until the pharmacist writes one.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, hospitalsDB, patientsDB, pharmacyInventoryDB, prescriptionsDB } from '@/lib/db';
import { advancePrescription, createPrescription as createPrescriptionScoped, getPrescriptionsByPatient } from '@/lib/services/prescription-service';
import { dispenseMedication, DispenseError } from '@/lib/services/dispensing-service';
import { safetyStops, unreviewedAllergyConflicts } from '@/lib/pharmacy/rx-safety';
import type { PrescriptionDoc } from '@/lib/db-types';

const DRUG_A = 'Warfarin 5mg';
const DRUG_B = 'Metronidazole 400mg';
const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const SCOPE = { role: 'super_admin' } as const;
const PHARMACIST = { _id: 'user-pharma-rose', name: 'Pharmacist Rose' };
const JUSTIFICATION = { reviewedBy: 'Dr. Wani', reason: 'No alternative is available at this facility.' };

const order = (medication: string, extra: Record<string, unknown> = {}) => createPrescriptionScoped({
  patientId: 'pat-1', patientName: 'Nyakuma Deng', medication, dose: '1', route: 'oral', frequency: 'OD',
  duration: '5 days', prescribedBy: 'Dr. Wani', status: 'pending', hospitalId: HOSP, orgId: ORG,
  quantityToDispense: 5, ...extra,
} as never, SCOPE);

const setAllergy = async (substance: string, criticality: string) => {
  const db = patientsDB();
  const patient = await db.get('pat-1') as Record<string, unknown>;
  await db.put({ ...patient, structuredAllergies: [{ id: 'a1', substance, criticality, status: 'active' }] } as never);
};

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'JTH', orgId: ORG } as never);
  await putDoc(usersDB(), {
    _id: PHARMACIST._id, type: 'user', username: 'pharma.rose', name: PHARMACIST.name,
    role: 'pharmacist', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(patientsDB(), {
    _id: 'pat-1', type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    registrationHospital: HOSP, orgId: ORG, state: 'Central Equatoria', county: 'Juba',
  } as never);
  await putDoc(pharmacyInventoryDB(), {
    _id: 'inv-amox', type: 'pharmacy_inventory', hospitalId: HOSP, hospitalName: 'JTH',
    medicationName: 'Amoxicillin 500mg', category: 'Antibiotic', stockLevel: 50, unit: 'tablets',
    reorderLevel: 5, batchNumber: 'B-1', expiryDate: '2099-01-01', dispensedToday: 0, orgId: ORG,
  } as never);
});

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

describe('safetyStops', () => {
  it('stops severe allergies and contraindications, not lower tiers', () => {
    expect(safetyStops({
      allergyWarnings: [{ allergy: 'Penicillin', requiresOverride: true }, { allergy: 'Latex', requiresOverride: false }],
      interactionWarnings: { interactions: [
        { drug1: 'A', drug2: 'B', severity: 'contraindicated' },
        { drug1: 'C', drug2: 'D', severity: 'serious' },
      ] },
    })).toEqual({ allergies: ['Penicillin'], interactions: ['A + B'] });
  });
});

describe('prescribing past a contraindicated interaction', () => {
  it('refuses without a written reason and records one when given', async () => {
    await order(DRUG_A);
    await expect(order(DRUG_B)).rejects.toThrow();
    const { prescription } = await order(DRUG_B, { medicationSafetyAcknowledgement: JUSTIFICATION });
    expect(prescription.medicationSafety?.acknowledgement?.reason).toBe(JUSTIFICATION.reason);
  });
});

describe('unreviewedAllergyConflicts', () => {
  const rx = { medication: 'Amoxicillin 500mg' } as PrescriptionDoc;
  const allergy = { substance: 'Penicillin', criticality: 'severe', status: 'active' } as never;

  it('finds a conflict nobody answered', () => {
    expect(unreviewedAllergyConflicts(rx, [allergy]).map(c => c.allergy)).toEqual(['Penicillin']);
  });
  it('leaves out one the prescriber justified', () => {
    expect(unreviewedAllergyConflicts({
      ...rx,
      medicationSafety: {
        assessedAt: '', interactionWarnings: [], duplicateWarnings: [],
        allergyWarnings: [{ medication: rx.medication, allergy: 'Penicillin', reason: 'class', criticality: 'severe', requiresOverride: true }],
        acknowledgement: { reviewedBy: 'Dr', reviewedAt: '', reason: 'tolerated before' },
      },
    }, [allergy])).toEqual([]);
  });
  it('leaves out one a pharmacist answered on an earlier fill', () => {
    expect(unreviewedAllergyConflicts({
      ...rx, dispenseAllergyReview: { allergies: ['Penicillin'], reviewedBy: 'R', reviewedAt: '', reason: 'confirmed' },
    }, [allergy])).toEqual([]);
  });
  it('ignores a mild allergy', () => {
    expect(unreviewedAllergyConflicts(rx, [{ substance: 'Penicillin', criticality: 'mild', status: 'active' } as never])).toEqual([]);
  });
});

describe('an allergy recorded after prescribing', () => {
  const dispense = (prescription: PrescriptionDoc, allergyReview?: string) => dispenseMedication({
    prescription, quantity: 5, dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
    facilityId: HOSP, orgId: ORG, allergyReview,
  });

  async function clearedOrder() {
    const { prescription } = await order('Amoxicillin 500mg');
    await advancePrescription(prescription._id, 'cleared_for_dispensing', undefined, PHARMACIST._id);
    return (await getPrescriptionsByPatient('pat-1', SCOPE)).find(r => r._id === prescription._id)!;
  }

  it('stops the handover, moves no stock, and clears with a written review', async () => {
    const cleared = await clearedOrder();
    await setAllergy('Penicillin', 'severe');

    const refused = await dispense(cleared).catch(err => err);
    expect(refused).toBeInstanceOf(DispenseError);
    expect(refused.code).toBe('ALLERGY_REVIEW_REQUIRED');
    expect((await pharmacyInventoryDB().get('inv-amox') as { stockLevel: number }).stockLevel).toBe(50);

    const { prescription } = await dispense(cleared, 'Prescriber confirmed tolerated last year.');
    expect(prescription.dispenseAllergyReview?.allergies).toEqual(['Penicillin']);
    const stored = await prescriptionsDB().get(prescription._id) as PrescriptionDoc;
    expect(stored.dispenseAllergyReview?.reviewedBy).toBe(PHARMACIST.name);
  });
});
