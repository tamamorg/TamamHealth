/**
 * @jest-environment node
 *
 * One account's audit trail.
 *
 * The account page could say who a person IS and never what they had DONE —
 * the only reader on this store answered "what happened lately" across
 * everyone. These pin the part an access review depends on: that the rows
 * returned belong to exactly one account, and that an account with no
 * identifier gets nothing rather than everything.
 */

const docs: Record<string, unknown>[] = [];

jest.mock('@/lib/db', () => ({ auditLogDB: () => ({}) }));
// `findByType` lives in the query helper, not the db module — mocking the
// wrong one let the real helper through and it reached for `db.find`.
jest.mock('@/lib/services/db-query', () => ({ findByType: async () => docs }));

import { getAuditLogsForUser } from '@/lib/services/audit-service';

const row = (o: Partial<Record<string, unknown>>) => ({
  _id: String(o.id ?? Math.random()), type: 'audit_log', success: true, details: '', ...o,
});

beforeEach(() => {
  docs.length = 0;
  docs.push(
    row({ id: 'a1', userId: 'u-1', username: 'amina', action: 'LOGIN', createdAt: '2026-08-01T10:00:00Z' }),
    row({ id: 'a2', userId: 'u-1', username: 'amina', action: 'PATIENT_UPDATE', createdAt: '2026-08-03T10:00:00Z' }),
    row({ id: 'b1', userId: 'u-2', username: 'bol', action: 'LOGIN', createdAt: '2026-08-02T10:00:00Z' }),
    // Written before the id was carried — name only.
    row({ id: 'old', username: 'amina', action: 'LEGACY_EDIT', createdAt: '2026-07-01T10:00:00Z' }),
  );
});

describe('getAuditLogsForUser', () => {
  it('returns only the rows belonging to that account', async () => {
    const rows = await getAuditLogsForUser({ id: 'u-1', username: 'amina' });
    expect(rows.map(r => r._id).sort()).toEqual(['a1', 'a2', 'old']);
    expect(rows.some(r => r._id === 'b1')).toBe(false);
  });

  it('orders newest first', async () => {
    const rows = await getAuditLogsForUser({ id: 'u-1', username: 'amina' });
    expect(rows.map(r => r._id)).toEqual(['a2', 'a1', 'old']);
  });

  it('falls back to username for rows written before the id was carried', async () => {
    const rows = await getAuditLogsForUser({ username: 'amina' });
    expect(rows.map(r => r._id)).toContain('old');
  });

  it('does NOT match another account whose id differs but name collides', async () => {
    // A username fallback must never reach a row that already names a
    // different account — that would merge two people's histories.
    docs.push(row({ id: 'x', userId: 'u-9', username: 'amina', action: 'LOGIN', createdAt: '2026-08-04T10:00:00Z' }));
    const rows = await getAuditLogsForUser({ id: 'u-1', username: 'amina' });
    expect(rows.map(r => r._id)).not.toContain('x');
  });

  it('returns nothing when the account has no identifier at all', async () => {
    // The dangerous default: no identifier must mean no history, never
    // "everyone", or one account's page reports the whole platform.
    await expect(getAuditLogsForUser({})).resolves.toEqual([]);
    await expect(getAuditLogsForUser({ id: undefined, username: undefined })).resolves.toEqual([]);
  });

  it('honours the limit, keeping the newest', async () => {
    const rows = await getAuditLogsForUser({ id: 'u-1', username: 'amina' }, 2);
    expect(rows.map(r => r._id)).toEqual(['a2', 'a1']);
  });

  it('returns an empty list for an account with no rows, not an error', async () => {
    await expect(getAuditLogsForUser({ id: 'nobody' })).resolves.toEqual([]);
  });
});
