/**
 * A request taken at the lab itself: an independent lab's own patient, or a
 * test sent in from another hospital. The lab registers the patient when they
 * are new (to the same required fields as the front desk), places the tests through the one order path (visit, bill, bench) and,
 * when the specimen arrived already drawn, books that in so the bench starts at
 * Receive.
 */

import { emptyLabOrderDraft, type OrderedTest } from './lab-order-types';
import { placeLabOrder, type LabOrderActor } from './place-lab-order';
import type { PatientDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

export type LabRequestSource = 'facility' | 'external_facility' | 'walk_in';

export interface NewLabPatient {
  firstName: string;
  surname: string;
  gender: string;
  dateOfBirth: string;
  estimatedAge: string;
  phone: string;
  state: string;
  county: string;
  primaryLanguage: string;
  nokName: string;
  nokRelationship: string;
  nokPhone: string;
}

export interface LabIntakeInput {
  patient?: PatientDoc;
  newPatient?: NewLabPatient;
  source: LabRequestSource;
  facility: string;
  requester: string;
  reference: string;
  tests: OrderedTest[];
  priority: 'routine' | 'urgent' | 'stat';
  arrivedCollected: boolean;
  collectedAt: string;
  collectedBy: string;
  notes: string;
}

export async function registerLabPatient(person: NewLabPatient, currentUser: LabOrderActor, scope: DataScope): Promise<PatientDoc> {
  const { createPatient } = await import('@/lib/services/patient-service');
  const now = new Date().toISOString();
  return createPatient({
    hospitalNumber: '',
    firstName: person.firstName.trim(),
    surname: person.surname.trim(),
    middleName: '',
    maidenName: '',
    gender: person.gender,
    dateOfBirth: person.dateOfBirth,
    estimatedAge: person.estimatedAge ? Number(person.estimatedAge) : undefined,
    phone: person.phone.trim(),
    state: person.state,
    county: person.county,
    primaryLanguage: person.primaryLanguage,
    nokName: person.nokName.trim(),
    nokRelationship: person.nokRelationship,
    nokPhone: person.nokPhone.trim(),
    // Clinical detail is the clinic's to collect: the "not asked yet" defaults.
    bloodType: 'Unknown',
    allergies: ['None known'],
    chronicConditions: ['None'],
    registrationHospital: currentUser.hospitalId || '',
    registrationDate: now.slice(0, 10),
    registeredAt: now,
    registeredBy: currentUser.name || currentUser.username || '',
    isActive: true,
    orgId: currentUser.orgId,
  } as unknown as Parameters<typeof createPatient>[0], scope);
}

export async function submitLabIntake(input: LabIntakeInput, currentUser: LabOrderActor, scope: DataScope) {
  const patient = input.patient
    ?? (input.newPatient ? await registerLabPatient(input.newPatient, currentUser, scope) : undefined);
  if (!patient) throw new Error('labOrder.errPatient');

  const outside = input.source === 'external_facility';
  const receipt = await placeLabOrder({
    patient,
    currentUser,
    draft: {
      ...emptyLabOrderDraft(input.requester.trim() || (input.source === 'walk_in' ? 'Self-request' : currentUser.name || '')),
      patientId: patient._id,
      tests: input.tests,
      priority: input.priority,
      notes: input.notes.trim(),
      collectionTiming: input.arrivedCollected ? 'lab_collect' : 'draw_now',
      requestSource: input.source,
      externalFacility: outside ? input.facility.trim() : undefined,
      externalRequester: outside ? input.requester.trim() : undefined,
      externalReference: outside ? input.reference.trim() : undefined,
    },
  });

  if (input.arrivedCollected) {
    const { advanceLabOrder } = await import('@/lib/services/lab-service');
    const at = (input.collectedAt ? new Date(input.collectedAt) : new Date()).toISOString();
    for (const id of receipt.createdIds) {
      await advanceLabOrder(id, 'specimen_collected', {
        specimenCollectedAt: at,
        specimenCollectedBy: input.collectedBy.trim() || (outside ? input.facility.trim() : '') || 'Outside',
        specimenCollectedOutside: true,
      });
    }
  }
  return { patient, receipt };
}
