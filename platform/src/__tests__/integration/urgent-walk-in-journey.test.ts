/**
 * Integration — the URGENT walk-in journey through the real service layer:
 * front-desk check-in (emergency acuity) → nurse ETAT assessment resuming the
 * clerical placeholder → emergency escalation of the visit.
 *
 * This is the path where the pieces most recently went missing in production:
 * the walk-in used to skip the triage doc entirely, the nurse's assessment
 * used to duplicate rather than resume it, and the escalation edge was
 * unreachable because no triage carried an encounterId. Each assertion below
 * pins one of those seams.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { createPatient } from '@/lib/services/patient-service';
import { checkInPatient } from '@/lib/services/check-in-service';
import {
  createTriage, getTriageByPatient, findActiveTriageForPatient, DuplicateActiveTriageError,
} from '@/lib/services/triage-service';
import { completeTriageHandoff } from '@/lib/services/triage-handoff-service';
import { getEncounter } from '@/lib/services/encounter-service';
import { hospitalsDB } from '@/lib/db';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG } as unknown as { _id: string });
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

async function registerAkot() {
  return createPatient({
    firstName: 'Akot', surname: 'Deng', gender: 'Male', dateOfBirth: '1988-06-02',
    phone: '+211925002001', state: 'Central Equatoria', county: 'Juba',
    primaryLanguage: 'Bari', nokName: 'Mary Deng', nokRelationship: 'Wife', nokPhone: '+211925002002',
    hospitalNumber: '', registrationHospital: HOSP, orgId: ORG,
  } as unknown as Parameters<typeof createPatient>[0]);
}

test('urgent walk-in: check-in opens one linked visit thread, triage resumes it, emergency escalates it', async () => {
  const p = await registerAkot();

  // 1. Front desk checks the walk-in in with an emergency acuity flag.
  const checkIn = await checkInPatient({
    patientId: p._id, patientName: `${p.firstName} ${p.surname}`,
    facilityId: HOSP, facilityName: 'Juba Teaching Hospital', orgId: ORG,
    modeOfArrival: 'ambulance', chiefComplaint: 'Crushing chest pain, collapsed at market',
    acuity: 'emergency',
    checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
  });

  // The clerical triage placeholder exists, is RED, and is BACK-LINKED to the
  // visit — the link every escalation affordance gates on.
  expect(checkIn.triage.status).toBe('pending');
  expect(checkIn.triage.priority).toBe('RED');
  expect(checkIn.triage.encounterId).toBe(checkIn.encounter._id);
  expect(checkIn.encounter.status).toBe('awaiting_triage');
  expect(checkIn.walkInAppointmentCreated).toBe(true);

  // The desk records provenance, never findings: ABCC must not be fabricated.
  expect(checkIn.triage.airway).toBe('not_assessed');
  expect(checkIn.triage.assessmentSource).toBe('clerical_checkin');

  // 2. The nurse's real assessment RESUMES the placeholder instead of
  // duplicating it.
  const assessed = await createTriage(
    {
      patientId: p._id, patientName: `${p.firstName} ${p.surname}`, facilityId: HOSP,
      priority: 'RED', status: 'seen', chiefComplaint: 'Crushing chest pain',
      airway: 'clear', breathing: 'distressed', circulation: 'impaired', consciousness: 'alert',
      assessmentSource: 'clinician',
      temperature: '36.8', pulse: '138', systolic: '84', diastolic: '52', spo2: '89', respiratoryRate: '32',
      triagedBy: 'user-triage.mary', triagedByName: 'Mary', orgId: ORG,
      encounterId: checkIn.encounter._id,
    } as unknown as Parameters<typeof createTriage>[0],
    { resumePendingId: checkIn.triage._id, actor: { userId: 'user-triage.mary', username: 'Mary' } },
  );
  expect(assessed?._id).toBe(checkIn.triage._id);

  const triagesForPatient = await getTriageByPatient(p._id);
  expect(triagesForPatient).toHaveLength(1); // resumed, not duplicated

  // 3. While that triage is active, a second create without resume is refused.
  await expect(createTriage({
    patientId: p._id, patientName: `${p.firstName} ${p.surname}`, facilityId: HOSP,
    priority: 'GREEN', status: 'pending', chiefComplaint: 'duplicate',
    triagedBy: 'user-triage.mary', triagedByName: 'Mary', orgId: ORG,
  } as unknown as Parameters<typeof createTriage>[0])).rejects.toThrow(DuplicateActiveTriageError);

  // 4. Emergency disposition escalates the SAME visit thread.
  await completeTriageHandoff({
    triageId: checkIn.triage._id,
    patientId: p._id, patientName: `${p.firstName} ${p.surname}`,
    disposition: 'emergency',
    actorId: 'user-triage.mary', actorName: 'Mary', actorRole: 'triage_nurse',
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
  });

  const visit = await getEncounter(checkIn.encounter._id);
  expect(visit?.status).toBe('escalated_to_emergency');

  // The active triage remains the one document, now dispositioned.
  const active = await findActiveTriageForPatient(p._id);
  expect(active?._id).toBe(checkIn.triage._id);
  expect(active?.disposition).toBe('emergency');
});
