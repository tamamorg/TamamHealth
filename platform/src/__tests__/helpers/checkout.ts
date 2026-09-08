import { medicalRecordsDB } from '@/lib/db';
import type { EncounterDoc } from '@/lib/db-types';

/** Minimal signed documentation for otherwise order-free legacy visit fixtures. */
export async function documentCheckout(encounter: EncounterDoc) {
  await medicalRecordsDB().put({ _id: `checkout-note-${encounter._id}`, type: 'medical_record',
    patientId: encounter.patientId, encounterId: encounter._id, orgId: encounter.orgId,
    hospitalId: encounter.hospitalId, signedAt: new Date().toISOString(), signedBy: 'test-doctor' });
}
