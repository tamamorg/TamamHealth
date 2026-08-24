'use client';

import { useEffect, useState } from 'react';
import type { BackupStatus } from '../services/backup-status-service';

/**
 * Backup status for the admin surfaces (KAN-117).
 *
 * Asks the SERVER first, and reads the local replica only if that fails.
 * Whether a backup ran is a fact about the server, and it is recorded there by
 * the backup job (POST /api/admin/backup). Reading it from the local replica
 * alone made the answer depend on one global config document completing a
 * round trip through 77-database replication — so a fresh device, a stalled
 * gateway or a wiped browser reported "No backup on record" for a backup the
 * server knew about, which is the exact false alarm the reporting endpoint
 * exists to end.
 *
 * The local read stays as the fallback because it is the offline answer, and
 * because `/api/admin/backup` answers `super_admin` only — the IT operations
 * panel is open to more roles than that and still needs a number.
 *
 * Returns `null` while loading — distinct from a loaded `state: 'unknown'`,
 * which is a real answer meaning "nothing has reported a backup". Collapsing
 * those two is how the screens this replaces ended up disagreeing with each
 * other about identical data.
 */
export function useBackupStatus(rpoHoursOverride?: number): BackupStatus | null {
  const [status, setStatus] = useState<BackupStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fromServer = await readFromServer(rpoHoursOverride);
        if (cancelled) return;
        if (fromServer) { setStatus(fromServer); return; }

        const { getBackupStatus } = await import('../services/backup-status-service');
        const s = await getBackupStatus(rpoHoursOverride);
        if (!cancelled) setStatus(s);
      } catch {
        // A failure to READ the status is itself unknown, not a failure of the
        // backup. Reporting it as overdue would raise a false alarm.
        if (!cancelled) {
          setStatus({
            state: 'unknown',
            lastBackupAt: null,
            ageHours: null,
            rpoHours: rpoHoursOverride ?? 24,
            detail: 'Backup status could not be read.',
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [rpoHoursOverride]);

  return status;
}

/**
 * The server's answer, or `null` for "ask somewhere else" — offline, or a role
 * the endpoint does not serve. Never throws: a failure here is not an answer,
 * it is a reason to fall back.
 */
async function readFromServer(rpoHours?: number): Promise<BackupStatus | null> {
  try {
    const { apiFetch } = await import('../api-fetch');
    const query = rpoHours ? `?rpoHours=${encodeURIComponent(String(rpoHours))}` : '';
    const res = await apiFetch(`/api/admin/backup${query}`);
    if (!res.ok) return null;
    const body = await res.json() as { status?: BackupStatus };
    return body.status ?? null;
  } catch {
    return null;
  }
}
