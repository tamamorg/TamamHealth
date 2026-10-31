/**
 * @jest-environment node
 *
 * Break-glass access to restricted mental-health notes is permitted only
 * because it is recorded. The audit row must be written, with the
 * organisation, BEFORE any note is returned; if it cannot be written the read
 * fails and nothing is released. A routine read, by contrast, is not blocked
 * by a failing audit store.
 */
jest.mock('server-only', () => ({}), { virtual: true });
const put = jest.fn(async (_doc: Record<string, unknown>) => ({ ok: true, rev: '1-a' }));
jest.mock('@/lib/db', () => ({
  auditLogDB: () => ({ put }),
  getDB: () => ({ put: jest.fn() }),
  isClosingConnectionError: () => false,
}));
jest.mock('@/lib/observability', () => ({ captureException: jest.fn() }));
const rows = [{
  _id: 'restricted-mh-1', type: 'restricted_mental_health_note', patientId: 'pat-1', patientName: 'A', episodeId: 'e1',
  category: 'general', hospitalId: 'hosp-1', orgId: 'org-a', authoredBy: 'u', authoredByName: 'U',
  authoredAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ciphertext: 'plain-not-enveloped',
}];
jest.mock('@/lib/services/db-query', () => ({ findByType: jest.fn(async () => rows) }));
jest.mock('@/lib/field-encryption', () => ({ decryptField: (v: string) => v, encryptField: (v: string) => v }));

import { getRestrictedMentalHealthNotes } from '@/modules/specialty-care/services/restricted-note-service.server';

const base = { patientId: 'pat-1', orgId: 'org-a', allowedFacilityIds: ['hosp-1'], actorId: 'u-doc', actorName: 'Dr Doc' };

beforeEach(() => {
  put.mockReset();
  put.mockImplementation(async () => ({ ok: true, rev: '1-a' }));
});

test('a break-glass read is audited with the organisation before the notes are returned', async () => {
  const notes = await getRestrictedMentalHealthNotes({ ...base, breakGlassReason: 'Patient unresponsive, urgent history' });
  expect(notes).toHaveLength(1);
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][0]).toMatchObject({
    action: 'RESTRICTED_MH_NOTE_BREAK_GLASS_READ', orgId: 'org-a', patientId: 'pat-1', userId: 'u-doc',
  });
});

test('if the break-glass audit row cannot be written, nothing is released', async () => {
  put.mockRejectedValue(new Error('audit store down'));
  await expect(getRestrictedMentalHealthNotes({ ...base, breakGlassReason: 'Patient unresponsive, urgent history' }))
    .rejects.toThrow('audit store down');
});

test('a routine read is not blocked by a failing audit store', async () => {
  put.mockRejectedValue(new Error('audit store down'));
  await expect(getRestrictedMentalHealthNotes(base)).resolves.toHaveLength(1);
});
