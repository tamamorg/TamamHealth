'use client';

import type { BaseDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Clock, AlertTriangle, GitCompareArrows } from '@/components/icons/lucide';

export type OfflineSyncMeta = NonNullable<BaseDoc['offlineSync']>;

/** Higher = more attention-worthy. 'local' is a declared status in the type
 *  that nothing in the codebase currently assigns (writes go straight to
 *  'pending' — see lib/sync/offline-metadata.ts), but a row still needs to
 *  treat it as "only on this device" rather than crash on an unknown key. */
const SEVERITY: Record<OfflineSyncMeta['status'], number> = {
  synced: 0,
  local: 1,
  pending: 1,
  failed: 2,
  conflict: 3,
};

/**
 * A single board/registry row can be built from more than one underlying
 * document — the front-desk queue's walk-in rows carry both a triage record
 * and the appointment check-in created for it. Pick whichever doc's sync
 * state is the most attention-worthy, so a failed/conflicted write on one
 * side is never hidden behind a merely-pending status on the other.
 *
 * Exported (rather than kept private) so row-builders can combine sources
 * and so the ranking itself is unit-testable independent of rendering.
 */
export function worstOfflineSync(
  ...syncs: Array<OfflineSyncMeta | undefined>
): OfflineSyncMeta | undefined {
  let worst: OfflineSyncMeta | undefined;
  for (const sync of syncs) {
    if (!sync) continue;
    if (!worst || SEVERITY[sync.status] > SEVERITY[worst.status]) worst = sync;
  }
  return worst;
}

/**
 * True for exactly the docs `SyncStatusBadge` would render a chip for. Shared
 * by every "N pending sync" summary and filter (patients registry, front-desk
 * board) so a doc's inclusion in a count and its badge visibility can never
 * drift apart.
 */
export function hasUnsyncedWrite(doc?: { offlineSync?: OfflineSyncMeta }): boolean {
  return !!doc?.offlineSync && doc.offlineSync.status !== 'synced';
}

export interface SyncStatusBadgeProps {
  /** The document's offline-sync metadata (`BaseDoc['offlineSync']`).
   *  Renders nothing when absent or already 'synced' — synced is the normal,
   *  quiet state and must not add noise to every row. */
  offlineSync?: OfflineSyncMeta;
  className?: string;
}

/**
 * Per-row indicator that a write made on this device has not reached the
 * server yet.
 *
 * Every create/update on a patient, appointment, or triage doc stamps
 * `offlineSync` (see `lib/sync/offline-metadata.ts`), but until this badge
 * existed nothing displayed it: a clerk registering a patient offline saw
 * the same success toast as online and never learned the record was
 * unpushed or, worse, conflicted with another device's copy.
 *
 * Accessibility: the state is never color-only — every tone pairs an icon
 * with a visible text label, and `title` explains what it means and that the
 * record is safe locally.
 */
export default function SyncStatusBadge({ offlineSync, className }: SyncStatusBadgeProps) {
  const { t } = useTranslation();
  if (!offlineSync || offlineSync.status === 'synced') return null;

  const variant = offlineSync.status === 'failed'
    ? {
        Icon: AlertTriangle,
        tone: 'danger' as const,
        label: t('sync.docFailedLabel'),
        tooltip: t('sync.docFailedTooltip'),
      }
    : offlineSync.status === 'conflict'
      ? {
          Icon: GitCompareArrows,
          tone: 'danger' as const,
          label: t('sync.docConflictLabel'),
          tooltip: t('sync.docConflictTooltip'),
        }
      // 'pending' and the unused 'local' status both mean "only on this
      // device so far" — same quiet treatment.
      : {
          Icon: Clock,
          tone: 'neutral' as const,
          label: t('sync.docPendingLabel'),
          tooltip: t('sync.docPendingTooltip'),
        };

  const { Icon } = variant;
  return (
    <span
      className={`sync-status-badge sync-status-badge--${variant.tone}${className ? ` ${className}` : ''}`}
      title={variant.tooltip}
    >
      <Icon className="sync-status-badge-icon" aria-hidden="true" />
      <span>{variant.label}</span>
    </span>
  );
}
