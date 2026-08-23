/**
 * The backup job's report endpoint — the link that was missing.
 *
 * `recordBackupCompleted` existed and `getBackupStatus` read what it wrote, but
 * nothing could call it: there was no route, so the status could only ever be
 * `unknown` and the Risk Center's HIGH "No backup on record" could never clear
 * however many backups succeeded. These pin the contract the backup script
 * signs against.
 */
import { buildSyncCanonicalPayload, computeSyncSignature, isSyncTimestampFresh } from '@/lib/sync-auth';

describe('backup report signing contract', () => {
  const SECRET = 'x'.repeat(48);
  const PATH = '/api/admin/backup';

  it('signs timestamp, nonce, method, path and body joined by newlines', () => {
    const body = JSON.stringify({ completedAt: '2026-08-23T02:00:00.000Z' });
    const canonical = buildSyncCanonicalPayload({
      timestamp: '1787000000', nonce: 'b3f1c0de-0000-4000-8000-000000000001',
      method: 'POST', pathname: PATH, body,
    });
    expect(canonical.split('\n')).toEqual([
      '1787000000',
      'b3f1c0de-0000-4000-8000-000000000001',
      'POST',
      PATH,
      body,
    ]);
    // The shell script computes exactly this with `openssl dgst -sha256 -hmac`.
    expect(computeSyncSignature(SECRET, {
      timestamp: '1787000000', nonce: 'b3f1c0de-0000-4000-8000-000000000001',
      method: 'POST', pathname: PATH, body,
    })).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('rejects a stale timestamp, so a captured report cannot be replayed later', () => {
    const now = 1787000000_000;
    expect(isSyncTimestampFresh('1787000000', now)).toBe(true);
    expect(isSyncTimestampFresh(String(1787000000 - 3600), now)).toBe(false);
    expect(isSyncTimestampFresh('not-a-timestamp', now)).toBe(false);
  });
});

describe('recordBackupCompleted', () => {
  it('refuses a timestamp it cannot parse rather than storing nonsense', async () => {
    jest.isolateModules(() => {});
    const { recordBackupCompleted } = await import('@/lib/services/backup-status-service');
    await expect(recordBackupCompleted('not a date')).rejects.toThrow('Invalid backup completion timestamp');
  });
});
