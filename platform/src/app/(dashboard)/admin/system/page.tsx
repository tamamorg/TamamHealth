'use client';

/**
 * Super-admin → System Health.
 * Storage-level view of the local PouchDB stores plus the build's stack facts.
 * Platform settings (identity, tenant defaults, maintenance) live on
 * /admin/config — this page deliberately holds no editable configuration.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SadbPage, SadbCard, SadbGridList, SadbGridRow, SadbKvRow, SadbChip } from '@/components/admin/sadb-ui';

interface DBStats {
  name: string;
  docCount: number;
}

/** Store, doc count, and a derived populated/empty status. */
const GRID_TEMPLATE = 'minmax(0, 1fr) 130px 110px';

export default function AdminSystemPage() {
  const { t } = useTranslation();

  const [dbStats, setDbStats] = useState<DBStats[]>([]);
  const [dbStatsLoading, setDbStatsLoading] = useState(true);

  // Load DB stats
  useEffect(() => {
    const loadStats = async () => {
      try {
        const { getDB } = await import('@/lib/db');
        // Every synced store, from the one canonical list — the old
        // hand-typed 17 names understated the "N stores · M documents"
        // headline against the ~76 stores the app actually holds, and had
        // already drifted from ItOperationsPanel's own 8-name copy.
        const { DATABASE_SYNC_CONFIGS } = await import('@/lib/sync/sync-config');
        const dbNames = DATABASE_SYNC_CONFIGS.map(c => ({
          key: c.localName,
          label: c.localName.replace(/^tamamhealth_/, '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()),
        }));
        // Run all db.info() calls concurrently — sequential awaits across 18
        // databases meant 18 round-trips on every page load.
        const stats: DBStats[] = await Promise.all(
          dbNames.map(async ({ key, label }) => {
            try {
              const db = getDB(key);
              const info = await db.info();
              return { name: label, docCount: info.doc_count };
            } catch {
              return { name: label, docCount: 0 };
            }
          })
        );
        setDbStats(stats);
      } catch (err) {
        console.error('Failed to load DB stats:', err);
      } finally {
        setDbStatsLoading(false);
      }
    };
    loadStats();
  }, []);

  const totalDocs = dbStats.reduce((sum, s) => sum + s.docCount, 0);

  return (
    <SadbPage>
      <SadbCard
        title="System Health"
        meta={dbStatsLoading ? '…' : `${dbStats.length} stores · ${totalDocs.toLocaleString()} documents`}
      >
        <SadbGridList
          template={GRID_TEMPLATE}
          minWidth={480}
          head={[t('system.database'), t('system.totalDocuments'), 'Status']}
          empty={dbStatsLoading ? t('system.loadingStats') : undefined}
        >
          {dbStats.map(db => (
            <SadbGridRow key={db.name} template={GRID_TEMPLATE}>
              <span>{db.name}</span>
              <span
                className="sadb-tenant-num"
                style={{ fontFamily: 'var(--font-platform-mono)', color: db.docCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                {db.docCount.toLocaleString()}
              </span>
              <span>
                <SadbChip tone={db.docCount > 0 ? 'green' : 'neutral'}>{db.docCount > 0 ? 'Populated' : 'Empty'}</SadbChip>
              </span>
            </SadbGridRow>
          ))}
        </SadbGridList>
      </SadbCard>

      <SadbCard title={t('system.systemInfo')}>
        {/* Stack facts, not versions: the old row said "Next.js 14" while the
            build ran 16 — a literal that drifts is worse than no number. The
            build version row is the one figure stamped at build time. */}
        <SadbKvRow label={t('system.storageEngine')} value="PouchDB (IndexedDB)" />
        <SadbKvRow label={t('system.platform')} value="Next.js (App Router)" />
        <SadbKvRow label={t('system.uiFramework')} value="Tailwind CSS" />
        <SadbKvRow label={t('system.auth')} value="JWT (Client-side)" />
        <SadbKvRow label="Build version" value={process.env.NEXT_PUBLIC_APP_VERSION || '—'} />
      </SadbCard>
    </SadbPage>
  );
}
