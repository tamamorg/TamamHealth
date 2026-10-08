/**
 * @jest-environment node
 *
 * On the server this module is shared by every request in the process. An
 * ambient "current user" there would stamp one user's organisation onto
 * another user's audit rows, so it must be impossible to set.
 */
const put = jest.fn(async (_doc: Record<string, unknown>) => ({ ok: true, rev: '1-a' }));
jest.mock('@/lib/db', () => ({ auditLogDB: () => ({ put }), isClosingConnectionError: () => false }));
jest.mock('@/lib/observability', () => ({ captureException: jest.fn() }));

import { logAudit, setAuditActor } from '@/lib/services/audit-service';

it('ignores an ambient actor outside the browser', async () => {
  setAuditActor({ userId: 'user-a', orgId: 'org-a', hospitalId: 'hosp-a', role: 'doctor' });
  await logAudit('X', undefined, undefined, 'request from someone else entirely');
  const doc = put.mock.calls[0][0];
  expect(doc.orgId).toBeUndefined();
  expect(doc.userId).toBeUndefined();
});

it('still takes an explicit context from a server route', async () => {
  put.mockClear();
  await logAudit('PATIENT_SEND_MESSAGE', 'pat-1', 'Deng', 'sent', true, { orgId: 'org-moh-ss', patientId: 'pat-1' });
  expect(put.mock.calls[0][0]).toMatchObject({ orgId: 'org-moh-ss', patientId: 'pat-1' });
});
