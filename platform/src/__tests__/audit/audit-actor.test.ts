/**
 * A write-audit row has to carry the organisation of whoever acted, or it never
 * leaves the device: the audit database is organisation-scoped, the push filter
 * drops a row with no (or another) `orgId`, and the server would refuse it.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/observability', () => ({ captureException: jest.fn() }));

import { teardownTestDBs } from '../helpers/test-db';
import { auditLogDB } from '@/lib/db';
import { logAudit, setAuditActor, getRecentAuditLogs } from '@/lib/services/audit-service';
import type { AuditLogDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

const rows = async () => {
  const res = await auditLogDB().allDocs({ include_docs: true });
  return res.rows.map(r => r.doc as unknown as AuditLogDoc).filter(d => d.type === 'audit_log');
};

const nurse = { userId: 'user-nurse-a', username: 'nurse.a', role: 'nurse', orgId: 'org-moh-ss', hospitalId: 'hosp-001' };

afterEach(async () => {
  setAuditActor(null);
  await teardownTestDBs();
});

it('files a row under the signed-in user’s organisation and facility', async () => {
  setAuditActor(nurse);
  await logAudit('HISTORY_ENTRY_CREATED', undefined, 'Nurse A', 'History entry h-1 recorded; domain=social');
  const [row] = await rows();
  expect(row).toMatchObject({
    orgId: 'org-moh-ss', hospitalId: 'hosp-001', role: 'nurse',
    // The caller passed no user id — the session supplies it.
    userId: 'user-nurse-a', username: 'Nurse A',
  });
});

it('is then visible to that organisation’s reviewers, and to nobody else’s', async () => {
  setAuditActor(nurse);
  await logAudit('NOTE_SIGNED', 'user-nurse-a', 'nurse.a', 'signed');
  const sameOrg = { role: 'org_admin', orgId: 'org-moh-ss', userId: 'u1' } as unknown as DataScope;
  const otherOrg = { role: 'org_admin', orgId: 'org-mercy', userId: 'u2' } as unknown as DataScope;
  expect(await getRecentAuditLogs(10, sameOrg)).toHaveLength(1);
  expect(await getRecentAuditLogs(10, otherOrg)).toHaveLength(0);
});

it('takes organisation and facility from one source, never one of each', async () => {
  setAuditActor(nurse);
  await logAudit('X', undefined, undefined, 'd', true, { orgId: 'org-explicit', patientId: 'pat-1', resourceType: 'history_entry' });
  const [row] = await rows();
  expect(row).toMatchObject({ orgId: 'org-explicit', patientId: 'pat-1', resourceType: 'history_entry' });
  // The session's facility belongs to the session's organisation, not this one.
  expect('hospitalId' in row).toBe(false);
});

it('records the signed-in person as the actor, and a different id from the caller as the subject', async () => {
  // A front-desk check-in booked for a doctor used to be filed under the doctor.
  setAuditActor({ ...nurse, userId: 'user-desk', role: 'front_desk' });
  await logAudit('ENCOUNTER_CREATED', 'user-dr-wani', 'Dr. Wani', 'checked in');
  const [row] = await rows();
  expect(row).toMatchObject({ userId: 'user-desk', subjectUserId: 'user-dr-wani', role: 'front_desk' });
  // …and the name is the actor's too. The audit screen shows the name, so the
  // desk user's id beside the doctor's name still read as the doctor's action.
  expect(row.username).toBe('nurse.a');
});

it('stops stamping after sign-out, so the next person does not inherit the last one', async () => {
  setAuditActor(nurse);
  setAuditActor(null);
  await logAudit('LOGIN_FAILED', undefined, 'someone', 'bad password', false);
  const [row] = await rows();
  expect(row.orgId).toBeUndefined();
  expect(row.userId).toBeUndefined();
  expect('hospitalId' in row).toBe(false);
});

it('never invents an organisation when none is known', async () => {
  await logAudit('X', 'u', 'n', 'd');
  const [row] = await rows();
  expect(row.orgId).toBeUndefined();
});
