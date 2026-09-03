/**
 * Server-safe public surface for the Tamam reference feature catalog.
 * This module contains no UI and no database access.
 */
export {
  TAMAM_REFERENCE_BASELINE_ID,
  TAMAM_FEATURE_IDS,
  type FeatureCatalogConfig,
  type FeatureCatalogMode,
  type FeatureCutoverStage,
  type FeatureDecision,
  type TamamFeatureDefinition,
  type TamamFeatureId,
  type ResolvedFeature,
} from './core/types';
export { TAMAM_FEATURE_REGISTRY, TAMAM_FEATURES } from './core/registry';
export {
  DEFAULT_FEATURE_CATALOG_CONFIG,
  normalizeFeatureCatalogConfig,
  resolveFeature,
  resolvePrimaryFeatureCatalog,
} from './core/cutover';
export { applyFeatureCatalogToNavigation } from './core/navigation';
