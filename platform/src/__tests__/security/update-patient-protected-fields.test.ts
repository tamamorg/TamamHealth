/**
 * @jest-environment node
 *
 * updatePatient is shared by the offline UI and the HTTP route, so it must
 * itself refuse portal credential fields and identity fields.
 */
const stored: Record<string, unknown> = {
  _id: 'pat-1', _rev: '1-a', type: 'patient', firstName: 'A', surname: 'B', orgId: 'org-a',
  hospitalNumber: 'H-1', portalUsername: 'asha', portalPasswordHash: 'orig-hash',
};
const put = jest.fn(async () => ({ ok: true, rev: '2-b' }));
jest.mock('@/lib/db', () => ({
  patientsDB: () => ({ get: async () => ({ ...stored }), put }),
  hospitalsDB: () => ({ get: async () => ({}) }),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
jest.mock('@/lib/validation', () => ({
  ...jest.requireActual('@/lib/validation'),
  validatePatientData: () => ({}),
}));

import { updatePatient } from '@/lib/services/patient-service';

it('does not let a generic update change portal credentials or the hospital number', async () => {
  await updatePatient('pat-1', {
    phone: '+211911111111',
    portalPasswordHash: 'evil', portalUsername: 'evil', portalDisabledAt: '2020-01-01',
    hospitalNumber: 'HACK',
  } as never);
  const written = (put.mock.calls[0] as unknown as [Record<string, unknown>])[0];
  expect(written.portalPasswordHash).toBe('orig-hash');
  expect(written.portalUsername).toBe('asha');
  expect(written.portalDisabledAt).toBeUndefined();
  expect(written.hospitalNumber).toBe('H-1');
  expect(written.phone).toBe('+211911111111');
});
