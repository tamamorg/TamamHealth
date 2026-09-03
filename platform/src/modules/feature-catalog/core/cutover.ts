import { TAMAM_FEATURE_REGISTRY } from './registry';
import {
  TAMAM_REFERENCE_BASELINE_ID,
  TAMAM_FEATURE_IDS,
  type FeatureCatalogConfig,
  type FeatureCatalogMode,
  type FeatureCutoverStage,
  type TamamFeatureId,
  type ResolvedFeature,
} from './types';

const MODES = new Set<FeatureCatalogMode>([
  'tamam_current',
  'tamam_shadow',
  'tamam_replacement',
]);

const STAGES = new Set<FeatureCutoverStage>([
  'legacy',
  'shadow',
  'replacement',
  'parked',
]);

const FEATURE_IDS = new Set<string>(TAMAM_FEATURE_IDS);

export const DEFAULT_FEATURE_CATALOG_CONFIG: FeatureCatalogConfig = Object.freeze({
  baselineId: TAMAM_REFERENCE_BASELINE_ID,
  mode: 'tamam_current',
  cutovers: Object.freeze({}),
});

type UnknownCatalog = {
  baselineId?: unknown;
  mode?: unknown;
  cutovers?: unknown;
} | null | undefined;

/**
 * Reads old, missing or hand-edited configuration fail-closed. A baseline
 * mismatch disables all replacement activation because its behavioral target
 * is unknown to this build.
 */
export function normalizeFeatureCatalogConfig(raw: UnknownCatalog): FeatureCatalogConfig {
  if (!raw || raw.baselineId !== TAMAM_REFERENCE_BASELINE_ID) {
    return DEFAULT_FEATURE_CATALOG_CONFIG;
  }

  const mode = typeof raw.mode === 'string' && MODES.has(raw.mode as FeatureCatalogMode)
    ? raw.mode as FeatureCatalogMode
    : 'tamam_current';

  const cutovers: Partial<Record<TamamFeatureId, FeatureCutoverStage>> = {};
  if (raw.cutovers && typeof raw.cutovers === 'object' && !Array.isArray(raw.cutovers)) {
    for (const [id, stage] of Object.entries(raw.cutovers)) {
      if (FEATURE_IDS.has(id) && typeof stage === 'string' && STAGES.has(stage as FeatureCutoverStage)) {
        cutovers[id as TamamFeatureId] = stage as FeatureCutoverStage;
      }
    }
  }

  return { baselineId: TAMAM_REFERENCE_BASELINE_ID, mode, cutovers };
}

export function resolveFeature(
  id: TamamFeatureId,
  rawConfig?: UnknownCatalog,
): ResolvedFeature {
  const definition = TAMAM_FEATURE_REGISTRY[id];
  const config = normalizeFeatureCatalogConfig(rawConfig);
  const configuredStage = config.cutovers[id] ?? definition.defaultStage;
  const currentRoute = definition.currentRoutes[0] ?? null;

  if (configuredStage === 'parked') {
    return {
      definition,
      stage: configuredStage,
      source: 'none',
      route: null,
      visibleInPrimaryNavigation: false,
      shadowEnabled: false,
    };
  }

  const shadowEnabled = config.mode !== 'tamam_current'
    && (configuredStage === 'shadow' || configuredStage === 'replacement')
    && Boolean(definition.replacementRoute);

  const replacementIsPrimary = config.mode === 'tamam_replacement'
    && configuredStage === 'replacement'
    && Boolean(definition.replacementRoute);

  if (replacementIsPrimary) {
    return {
      definition,
      stage: configuredStage,
      source: 'replacement',
      route: definition.replacementRoute ?? null,
      visibleInPrimaryNavigation: definition.primaryNavigation === true,
      shadowEnabled: true,
    };
  }

  return {
    definition,
    stage: configuredStage,
    source: currentRoute ? 'current' : 'none',
    route: currentRoute,
    visibleInPrimaryNavigation: Boolean(currentRoute) && definition.primaryNavigation === true,
    shadowEnabled,
  };
}

export function resolvePrimaryFeatureCatalog(rawConfig?: UnknownCatalog): readonly ResolvedFeature[] {
  return TAMAM_FEATURE_IDS
    .map(id => resolveFeature(id, rawConfig))
    .filter(featureState => featureState.visibleInPrimaryNavigation);
}
