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
        const dbNames = [
          { key: 'tamamhealth_users', label: t('system.dbUsers') },
          { key: 'tamamhealth_patients', label: t('system.dbPatients') },
          { key: 'tamamhealth_hospitals', label: t('system.dbHospitals') },
          { key: 'tamamhealth_medical_records', label: t('system.dbMedicalRecords') },
          { key: 'tamamhealth_referrals', label: t('system.dbReferrals') },
          { key: 'tamamhealth_lab_results', label: t('system.dbLabResults') },
          { key: 'tamamhealth_disease_alerts', label: t('system.dbDiseaseAlerts') },
          { key: 'tamamhealth_prescriptions', label: t('system.dbPrescriptions') },
          { key: 'tamamhealth_audit_log', label: t('system.dbAuditLog') },
          { key: 'tamamhealth_messages', label: t('system.dbMessages') },
          { key: 'tamamhealth_births', label: t('system.dbBirths') },
          { key: 'tamamhealth_deaths', label: t('system.dbDeaths') },
          { key: 'tamamhealth_immunizations', label: t('system.dbImmunizations') },
          { key: 'tamamhealth_anc', label: t('system.dbAncVisits') },
          { key: 'tamamhealth_follow_ups', label: t('system.dbFollowUps') },
          { key: 'tamamhealth_organizations', label: t('system.dbOrganizations') },
          { key: 'tamamhealth_platform_config', label: t('system.dbPlatformConfig') },
        ];
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
        <SadbKvRow label={t('system.storageEngine')} value="PouchDB (IndexedDB)" />
        <SadbKvRow label={t('system.platform')} value="Next.js 14" />
        <SadbKvRow label={t('system.uiFramework')} value="Tailwind CSS" />
        <SadbKvRow label={t('system.auth')} value="JWT (Client-side)" />
      </SadbCard>
    </SadbPage>
  );
}
