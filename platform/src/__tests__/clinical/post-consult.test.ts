jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
jest.mock('@/modules/identity/services/user-client', () => ({ getClientUsers: jest.fn(async () => [{ _id: 'replacement', role: 'nurse', isActive: true }]) }));
import { encountersDB, prescriptionsDB, appointmentsDB, labResultsDB, proceduresDB } from '@/lib/db';
import { teardownTestDBs } from '../helpers/test-db';
import { newPostConsultHandoff, postConsultReady } from '@/modules/post-consult';
import { getHandoffQueue, updateHandoff } from '@/modules/post-consult/services/handoff-service';
import type { EncounterDoc } from '@/lib/db-types';
import { buildValidateDocUpdateFn } from '@/lib/sync/write-permissions';
const scope = { userId: 'nurse', role: 'nurse' as const, orgId: 'org', hospitalId: 'hospital' };
let doc: EncounterDoc;
beforeEach(async () => {
  doc = { _id: 'visit', type: 'clinical_encounter', patientId: 'patient', patientName: 'Test Patient', hospitalId: 'hospital', orgId: 'org', status: 'ready_for_clinic_checkout', postConsult: newPostConsultHandoff() } as EncounterDoc;
  doc._rev = (await encountersDB().put(doc)).rev;
});
afterEach(teardownTestDBs);
test('scope and financial-only role cannot change handoff', async () => {
  await expect(updateHandoff(doc._id, doc._rev!, { type: 'accept' }, { ...scope, orgId: 'other' })).rejects.toThrow('NOT_FOUND');
  await expect(updateHandoff(doc._id, doc._rev!, { type: 'accept' }, { ...scope, role: 'front_desk' })).rejects.toThrow('FORBIDDEN');
  expect(await getHandoffQueue({ ...scope, orgId: 'other' })).toEqual([]);
});
test('ownership and revision prevent stale checklist updates', async () => {
  const accepted = await updateHandoff(doc._id, doc._rev!, { type: 'accept' }, scope);
  await expect(updateHandoff(doc._id, doc._rev!, { type: 'accept' }, scope)).rejects.toThrow('CONFLICT');
  await expect(updateHandoff(doc._id, accepted._rev!, { type: 'accept' }, { ...scope, userId: 'another' })).rejects.toThrow('ALREADY_OWNED');
  expect(postConsultReady(accepted.postConsult)).toBe(false);
});
test('generic encounter patch cannot erase or bypass pending handoff', async () => {
  const { updateEncounter } = await import('@/lib/services/encounter-service');
  expect(await updateEncounter(doc._id, { postConsult: undefined })).toBeNull();
  expect(await updateEncounter(doc._id, { status: 'discharged' })).toBeNull();
});
test('deferred work needs evidence, a responsible worker and future review date', async () => {
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'accept' }, scope);
  await expect(updateHandoff(doc._id, doc._rev!, { type: 'task', kind: 'followup', status: 'deferred', note: 'Call tomorrow' }, scope)).rejects.toThrow('INVALID');
  for (const task of doc.postConsult!.tasks) {
    doc = await updateHandoff(doc._id, doc._rev!, { type: 'task', kind: task.kind, status: 'deferred', note: 'Responsible nurse will review', ownerId: 'nurse', dueAt: '2099-01-01T12:00:00Z' }, scope);
  }
  expect(postConsultReady(doc.postConsult)).toBe(true);
  expect(await getHandoffQueue(scope)).toHaveLength(1);
});
test('only a clinician can document no separate nursing step', async () => {
  await expect(updateHandoff(doc._id, doc._rev!, { type: 'bypass', reason: 'Clinician provided instructions' }, scope)).rejects.toThrow('INVALID');
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'bypass', reason: 'Clinician completed instructions; no nursing orders.' }, { ...scope, role: 'doctor' });
  expect(postConsultReady(doc.postConsult)).toBe(true);
});
test('replication rejects receptionist attestations and routine discharge with pending tasks', () => {
  const validate = new Function(`return (${buildValidateDocUpdateFn()})`)();
  const desk = { name: 'desk', roles: ['org:org', 'role:front_desk', 'facility:hospital'] };
  expect(() => validate({ ...doc, status: 'discharged' }, doc, desk, {})).toThrow();
  expect(() => validate({ ...doc, postConsult: { ...doc.postConsult, ownerId: 'desk' } }, doc, desk, {})).toThrow();
});

test('clinician can recover an abandoned handoff without losing completed evidence', async () => {
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'accept' }, scope);
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'task', kind: 'education', status: 'done', note: 'Teach-back recorded' }, scope);
  await expect(updateHandoff(doc._id, doc._rev!, { type: 'transfer', ownerId: 'replacement', reason: 'Shift ended' }, { ...scope, userId: 'unrelated' })).rejects.toThrow('FORBIDDEN');
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'transfer', ownerId: 'replacement', reason: 'Shift ended' }, { ...scope, userId: 'doctor', role: 'doctor' });
  expect(doc.postConsult!.tasks[0].recordedBy).toBe('nurse');
  expect(doc.postConsult!.acceptedAt).toBeUndefined();
  await expect(updateHandoff(doc._id, doc._rev!, { type: 'task', kind: 'treatments', status: 'done', note: 'Reviewed' }, { ...scope, userId: 'replacement' })).rejects.toThrow('NOT_ACCEPTED');
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'accept' }, { ...scope, userId: 'replacement' });
  expect(doc.postConsult!.transfers![0].actorId).toBe('doctor');
});

test('new orders invalidate an exception and re-review archives previous evidence', async () => {
  const doctor = { ...scope, role: 'doctor' as const };
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'bypass', reason: 'No nursing orders' }, doctor);
  const reviewed = doc.postConsult!.reviewedPlan;
  await prescriptionsDB().put({ _id: 'new-rx', type: 'prescription', patientId: 'patient', encounterId: doc._id, orgId: 'org', hospitalId: 'hospital', status: 'pending' });
  const { currentPlanRevision } = await import('@/modules/post-consult/services/plan-service');
  expect(await currentPlanRevision(doc, scope)).not.toBe(reviewed);
  expect(await getHandoffQueue(scope)).toHaveLength(1);
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'reopen', reason: 'New treatment plan' }, doctor);
  expect(doc.postConsult!.bypass).toBeUndefined();
  expect(doc.postConsult!.history![0].handoff.bypass).toBeDefined();
  expect(postConsultReady(doc.postConsult)).toBe(false);
});

test('pending-items flags cannot authorize their own discharge', async () => {
  const { dischargeEncounter } = await import('@/lib/services/encounter-service');
  await expect(dischargeEncounter(doc._id, { pendingItems: true })).rejects.toThrow('FORBIDDEN');
  await expect(dischargeEncounter(doc._id, { actorId: 'desk', actorRole: 'front_desk', pendingItems: true, reason: 'Doctor said so' })).rejects.toThrow('REQUIRES_CLINICIAN');
  await expect(dischargeEncounter(doc._id, { actorId: 'doctor', actorRole: 'doctor', pendingItems: true })).rejects.toThrow('REQUIRES_CLINICIAN');
  expect((await encountersDB().get(doc._id) as EncounterDoc).status).toBe('ready_for_clinic_checkout');
});

test('replication binds ownership and task attestations to the provisioned identity', async () => {
  const validate = new Function(`return (${buildValidateDocUpdateFn()})`)();
  const nurse = { name: 'gateway-opaque', roles: ['org:org', 'role:nurse', 'facility:hospital', 'user:nurse'] };
  const accepted = await updateHandoff(doc._id, doc._rev!, { type: 'accept' }, scope);
  expect(() => validate(accepted, doc, nurse, {})).not.toThrow();
  expect(() => validate({ ...accepted, postConsult: { ...accepted.postConsult, ownerId: 'victim' } }, doc, nurse, {})).toThrow();
  const completed = await updateHandoff(doc._id, accepted._rev!, { type: 'task', kind: 'education', status: 'done', note: 'Teach back' }, scope);
  expect(() => validate(completed, accepted, nurse, {})).not.toThrow();
  completed.postConsult!.tasks[0].recordedBy = 'victim';
  expect(() => validate(completed, accepted, nurse, {})).toThrow();
});

test.each(['prescription', 'lab_result', 'procedure'])('appointment completion checks live %s even after nursing review', async type => {
  const db = type === 'prescription' ? prescriptionsDB() : type === 'lab_result' ? labResultsDB() : proceduresDB();
  await db.put({ _id: 'outstanding', type, patientId: 'patient', encounterId: doc._id, orgId: 'org', hospitalId: 'hospital',
    status: type === 'lab_result' ? 'completed' : type === 'procedure' ? 'ordered' : 'pending',
    orderStatus: type === 'lab_result' ? 'resulted' : undefined, critical: true, medication: 'Test medicine', testName: 'Test lab', name: 'Test procedure' });
  const { documentCheckout } = await import('../helpers/checkout');
  await documentCheckout(doc);
  doc.appointmentId = 'booking';
  doc._rev = (await encountersDB().put(doc)).rev;
  await appointmentsDB().put({ _id: 'booking', type: 'appointment', patientId: 'patient', orgId: 'org', facilityId: 'hospital', status: 'in_consultation' });
  doc = await updateHandoff(doc._id, doc._rev!, { type: 'accept' }, scope);
  for (const task of doc.postConsult!.tasks) doc = await updateHandoff(doc._id, doc._rev!, { type: 'task', kind: task.kind, status: 'done', note: 'Nursing coordination complete' }, scope);
  expect(postConsultReady(doc.postConsult)).toBe(true);
  const { dischargeEncounter } = await import('@/lib/services/encounter-service');
  await expect(dischargeEncounter(doc._id, { actorId: 'desk', actorRole: 'front_desk' })).rejects.toThrow('CHECKOUT_BLOCKED');
  const { updateAppointmentStatus } = await import('@/lib/services/appointment-service');
  expect(await updateAppointmentStatus('booking', 'completed', { actorId: 'desk', actorRole: 'front_desk' })).toBeNull();
  expect((await appointmentsDB().get('booking') as { status: string }).status).toBe('in_consultation');
});

test('sync metadata does not invalidate a review, but changed clinical content does', async () => {
  const { currentPlanRevision } = await import('@/modules/post-consult/services/plan-service');
  const rx = { _id: 'rx', type: 'prescription', patientId: 'patient', orgId: 'org', hospitalId: 'hospital', dose: 'Original dose' };
  let rev = (await prescriptionsDB().put(rx)).rev;
  const original = await currentPlanRevision(doc, scope);
  rev = (await prescriptionsDB().put({ ...rx, _rev: rev, offlineSync: { status: 'synced' }, updatedAt: new Date().toISOString() })).rev;
  expect(await currentPlanRevision(doc, scope)).toBe(original);
  await prescriptionsDB().put({ ...rx, _rev: rev, dose: 'Changed dose' });
  expect(await currentPlanRevision(doc, scope)).not.toBe(original);
});

test('current note creation resolves only the scoped matching visit and rejects ambiguity', async () => {
  const { resolveNoteEncounter } = await import('@/modules/post-consult/services/note-encounter-service');
  expect(await resolveNoteEncounter('patient', scope)).toBe('visit');
  expect(await resolveNoteEncounter('patient', { ...scope, orgId: 'another' })).toBeUndefined();
  expect(await resolveNoteEncounter('patient', scope, 'different-booking')).toBeUndefined();
  await encountersDB().put({ ...doc, _id: 'other-visit', _rev: undefined });
  await expect(resolveNoteEncounter('patient', scope)).rejects.toThrow('AMBIGUOUS_NOTE_ENCOUNTER');
});
