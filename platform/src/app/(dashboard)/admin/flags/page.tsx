'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import type { OrganizationDoc } from '@/lib/db-types';
import { SaTable, SaPill } from '@/components/admin/sa-ui';
import {
  SadbPage, SadbSettingGroup, SadbSettingRow, SadbToggle, SadbKvRow, SadbHeadLink, SadbSearch,
} from '@/components/admin/sadb-ui';
import Select from '@/components/Select';
import {
  TAMAM_FEATURES,
  TAMAM_REFERENCE_BASELINE_ID,
  type FeatureCatalogMode,
  type FeatureCutoverStage,
  type TamamFeatureId,
} from '@/modules/feature-catalog/client';
import { useTranslation } from '@/lib/i18n/useTranslation';

type FlagKey = keyof OrganizationDoc['featureFlags'];

const TENANT_FLAGS: { key: FlagKey; label: string }[] = [
  { key: 'epidemicIntelligence', label: 'Epidemic' },
  { key: 'mchAnalytics', label: 'MCH' },
  { key: 'dhis2Export', label: 'DHIS2' },
  { key: 'communityHealth', label: 'Community' },
  { key: 'facilityAssessments', label: 'Assessments' },
];

const planTone = (plan: OrganizationDoc['subscriptionPlan']) =>
  plan === 'enterprise' ? 'info' as const : plan === 'professional' ? 'ok' as const : 'muted' as const;

const CATALOG_MODES: { value: FeatureCatalogMode; labelKey: string }[] = [
  { value: 'tamam_current', labelKey: 'featureCatalog.mode.current' },
  { value: 'tamam_shadow', labelKey: 'featureCatalog.mode.shadow' },
  { value: 'tamam_replacement', labelKey: 'featureCatalog.mode.replacement' },
];

const CUTOVER_STAGES: { value: FeatureCutoverStage; labelKey: string }[] = [
  { value: 'legacy', labelKey: 'featureCatalog.stage.current' },
  { value: 'shadow', labelKey: 'featureCatalog.stage.shadow' },
  { value: 'replacement', labelKey: 'featureCatalog.stage.replacement' },
  { value: 'parked', labelKey: 'featureCatalog.stage.parked' },
];

export default function AdminFlagsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { config, loading: configLoading, update: updateConfig } = usePlatformConfig();
  const { organizations, loading: orgsLoading, update: updateOrg } = useOrganizations();

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [matrixSearch, setMatrixSearch] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  // Optimistic per-cell overrides so the matrix reads back instantly; cleared
  // on success (the store has caught up) and on failure (rolled back to the
  // store's actual value) so a failed write can never leave a cell drifted.
  const [cellOverrides, setCellOverrides] = useState<Record<string, boolean>>({});

  const clearOverride = (cellKey: string) => setCellOverrides(prev => {
    if (!(cellKey in prev)) return prev;
    const next = { ...prev };
    delete next[cellKey];
    return next;
  });

  const orgsWithAllFlagsOff = useMemo(
    () => organizations.filter(o => TENANT_FLAGS.every(f => !o.featureFlags[f.key])).length,
    [organizations]
  );

  const mostEnabledFlag = useMemo(() => {
    if (organizations.length === 0) return null;
    let best: { label: string; count: number } | null = null;
    for (const f of TENANT_FLAGS) {
      const count = organizations.filter(o => o.featureFlags[f.key]).length;
      if (!best || count > best.count) best = { label: f.label, count };
    }
    return best;
  }, [organizations]);

  const toggleSignups = async (next: boolean) => {
    if (!config) return;
    setSavingKey('signupsEnabled');
    try {
      await updateConfig({
        globalFeatureFlags: { ...config.globalFeatureFlags, signupsEnabled: next },
      }, currentUser?._id, currentUser?.username);
      showToast('Platform flag updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update flag.', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const filteredOrgs = useMemo(() => {
    const q = matrixSearch.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter(o => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q));
  }, [organizations, matrixSearch]);

  const toggleTenantFlag = async (org: OrganizationDoc, key: FlagKey, next: boolean) => {
    const cellKey = `${org._id}:${key}`;
    setSavingKey(cellKey);
    setCellOverrides(prev => ({ ...prev, [cellKey]: next }));
    try {
      await updateOrg(org._id, { featureFlags: { ...org.featureFlags, [key]: next } }, currentUser?._id, currentUser?.username);
      showToast(`${TENANT_FLAGS.find(f => f.key === key)?.label} ${next ? 'enabled' : 'disabled'} for ${org.name}.`, 'success');
      clearOverride(cellKey);
    } catch (err) {
      clearOverride(cellKey); // roll back — the write failed, the optimistic value must not stand
      showToast(err instanceof Error ? err.message : 'Failed to update flag.', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const saveCatalog = async (
    mode: FeatureCatalogMode,
    cutovers: Record<string, FeatureCutoverStage>,
    saving: string,
  ) => {
    setSavingKey(saving);
    try {
      await updateConfig({
        featureCatalog: { baselineId: TAMAM_REFERENCE_BASELINE_ID, mode, cutovers },
      }, currentUser?._id, currentUser?.username);
      showToast(t('featureCatalog.toast.updated'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('featureCatalog.toast.failed'), 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const updateCatalogMode = (mode: FeatureCatalogMode) => {
    if (!config) return;
    void saveCatalog(mode, config.featureCatalog?.cutovers ?? {}, 'catalog-mode');
  };

  const updateCatalogStage = (id: TamamFeatureId, stage: FeatureCutoverStage) => {
    if (!config) return;
    void saveCatalog(
      config.featureCatalog?.mode ?? 'tamam_current',
      { ...(config.featureCatalog?.cutovers ?? {}), [id]: stage },
      `catalog:${id}`,
    );
  };

  const filteredFeatures = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return TAMAM_FEATURES;
    return TAMAM_FEATURES.filter(feature =>
      `${feature.capability} ${feature.ownerModule} ${feature.id} ${feature.currentRoutes.join(' ')}`
        .toLowerCase()
        .includes(query),
    );
  }, [catalogSearch]);

  return (
    <SadbPage>

      <SadbSettingGroup
        title="Platform gates"
        meta={<SadbHeadLink onClick={() => router.push('/admin/config')}>Configuration</SadbHeadLink>}
      >
        {configLoading || !config ? (
          <p className="sadb-empty">Loading…</p>
        ) : (
          <>
            <SadbSettingRow
              label="New signups enabled (platform-wide)"
              sub="Controls whether new organizations can self-register across the entire platform."
            >
              <SadbToggle
                checked={config.globalFeatureFlags.signupsEnabled}
                onChange={toggleSignups}
                label="New signups enabled (platform-wide)"
                disabled={savingKey === 'signupsEnabled'}
              />
            </SadbSettingRow>
            <SadbKvRow
              label="Maintenance mode (platform-wide)"
              chip={config.maintenanceMode ? 'ON' : 'OFF'}
              chipTone={config.maintenanceMode ? 'yellow' : 'neutral'}
            />
          </>
        )}
      </SadbSettingGroup>

      <div className="sadb-card" data-tour="admin-feature-catalog">
        <div className="sadb-card-head" style={{ padding: '12px 16px' }}>
          <div>
            <h3 className="sadb-card-title">{t('featureCatalog.title')}</h3>
            <p className="sadb-card-meta" style={{ margin: '3px 0 0' }}>
              {t('featureCatalog.summary', { count: TAMAM_FEATURES.length })}
            </p>
          </div>
          <Select
            aria-label={t('featureCatalog.modeLabel')}
            value={config?.featureCatalog?.mode ?? 'tamam_current'}
            disabled={!config || savingKey === 'catalog-mode'}
            onChange={event => updateCatalogMode(event.target.value as FeatureCatalogMode)}
            style={{ width: 210 }}
          >
            {CATALOG_MODES.map(option => (
              <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
            ))}
          </Select>
        </div>
        <div className="sadb-search-row">
          <SadbSearch
            value={catalogSearch}
            onChange={setCatalogSearch}
            placeholder={t('featureCatalog.searchPlaceholder')}
            ariaLabel={t('featureCatalog.searchLabel')}
          />
        </div>
        <SaTable
          columns={[
            { label: t('featureCatalog.column.capability'), w: 2.2 },
            { label: t('featureCatalog.column.owner'), w: 1.2 },
            { label: t('featureCatalog.column.delivery'), w: 0.8 },
            { label: t('featureCatalog.column.surface'), w: 1.8 },
            { label: t('featureCatalog.column.rollout'), w: 1.2 },
          ]}
          empty={configLoading ? t('featureCatalog.loading') : t('featureCatalog.empty')}
          minWidth={920}
        >
          {filteredFeatures.map(feature => {
            const stage = config?.featureCatalog?.cutovers?.[feature.id] ?? feature.defaultStage;
            const replacementReady = Boolean(feature.replacementRoute);
            return (
              <tr key={feature.id}>
                <td>
                  <strong>{t(`featureCatalog.capability.${feature.id}`)}</strong>{' '}
                  <SaPill tone={feature.decision === 'reuse' ? 'ok' : feature.decision === 'development_only' ? 'muted' : 'info'}>
                    {t(`featureCatalog.decision.${feature.decision}`)}
                  </SaPill>
                </td>
                <td>{feature.ownerModule.replaceAll('-', ' ')}</td>
                <td>{feature.deliveryWaves.map(wave => `W${wave}`).join(', ')}</td>
                <td>{feature.currentRoutes.join(', ') || t('featureCatalog.notExposed')}</td>
                <td>
                  <Select
                    aria-label={t('featureCatalog.stageLabel', { capability: t(`featureCatalog.capability.${feature.id}`) })}
                    value={stage}
                    disabled={!config || savingKey === `catalog:${feature.id}`}
                    onChange={event => updateCatalogStage(feature.id, event.target.value as FeatureCutoverStage)}
                    style={{ minWidth: 145 }}
                  >
                    {CUTOVER_STAGES.map(option => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={(option.value === 'shadow' || option.value === 'replacement') && !replacementReady}
                      >
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            );
          })}
        </SaTable>
        <p className="sadb-card-meta" style={{ padding: '10px 14px', margin: 0, borderTop: '1px solid var(--border-light)' }}>
          {t('featureCatalog.guidance')}
        </p>
      </div>

      {/* data-tour anchor: the shared "sadb-card" class also matches the
          "Platform gates" group above, so the tour needs an unambiguous hook
          for this specific card. */}
      <div className="sadb-card" data-tour="admin-flags-matrix">
        <div className="sadb-card-head" style={{ padding: '12px 16px' }}>
          <h3 className="sadb-card-title">Per-tenant feature matrix</h3>
          <div className="sadb-legend">
            <span><i style={{ background: 'var(--text-muted)' }} />Orgs total ({orgsLoading ? '…' : organizations.length})</span>
            <span><i style={{ background: orgsWithAllFlagsOff > 0 ? 'var(--color-warning-600)' : 'var(--text-muted)' }} />All flags off ({orgsLoading ? '…' : orgsWithAllFlagsOff})</span>
            <span><i style={{ background: 'var(--color-success-800)' }} />{mostEnabledFlag ? `Most enabled: ${mostEnabledFlag.label}` : 'Most enabled'} ({mostEnabledFlag ? mostEnabledFlag.count : '—'})</span>
          </div>
        </div>
        <div className="sadb-search-row">
          <SadbSearch value={matrixSearch} onChange={setMatrixSearch} placeholder="Search organizations…" ariaLabel="Search organizations" />
        </div>
        <SaTable
          /* The tenant name is a name; every other column is a toggle. */
          columns={[
            { label: 'Organization', w: 2.2 },
            ...TENANT_FLAGS.map(f => ({ label: f.label, w: 1 })),
          ]}
          empty={orgsLoading ? 'Loading organizations…' : 'No organizations match this search.'}
          minWidth={880}
        >
          {filteredOrgs.map(org => (
            <tr key={org._id}>
              <td>
                <strong>{org.name}</strong>{' '}
                <SaPill tone={planTone(org.subscriptionPlan)}>{org.subscriptionPlan}</SaPill>
              </td>
              {TENANT_FLAGS.map(f => {
                const cellKey = `${org._id}:${f.key}`;
                const checked = cellOverrides[cellKey] ?? org.featureFlags[f.key];
                return (
                  <td key={f.key} style={{ textAlign: 'center' }}>
                    <SadbToggle
                      checked={checked}
                      disabled={savingKey === cellKey}
                      onChange={next => toggleTenantFlag(org, f.key, next)}
                      label={`${f.label} for ${org.name}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </SaTable>
        <p className="sadb-card-meta" style={{ padding: '10px 14px', margin: 0, borderTop: '1px solid var(--border-light)' }}>
          Changes apply on the tenant&apos;s next sync.
        </p>
      </div>

    </SadbPage>
  );
}
