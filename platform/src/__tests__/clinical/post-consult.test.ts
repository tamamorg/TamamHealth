jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
import { encountersDB } from '@/lib/db';
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
