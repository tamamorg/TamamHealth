export const TAMAM_REFERENCE_BASELINE_ID = 'tamam-reference-2026-09' as const;

export const TAMAM_FEATURE_IDS = [
  'active-visits',
  'appointments',
  'bed-management',
  'billing',
  'cohort-builder',
  'devtools',
  'dispensing',
  'fast-data-entry',
  'form-builder',
  'form-engine',
  'generic-patient-widgets',
  'help-menu',
  'home',
  'implementer-tools',
  'laboratory',
  'login',
  'metadata-export',
  'open-concept-lab',
  'patient-allergies',
  'patient-attachments',
  'patient-banner',
  'patient-chart',
  'patient-conditions',
  'patient-flags',
  'patient-forms',
  'patient-growth-chart',
  'patient-immunizations',
  'patient-label-printing',
  'patient-list-management',
  'patient-lists',
  'patient-medications',
  'patient-notes',
  'patient-orders',
  'patient-programs',
  'patient-registration',
  'patient-search',
  'patient-task-list',
  'patient-tests',
  'patient-vitals',
  'patient-procedures',
  'primary-navigation',
  'reports',
  'service-queues',
  'stock-management',
  'system-admin',
  'user-onboarding',
  'ward',
] as const;

export type TamamFeatureId = (typeof TAMAM_FEATURE_IDS)[number];

export type FeatureCatalogMode =
  | 'tamam_current'
  | 'tamam_shadow'
  | 'tamam_replacement';

export type FeatureCutoverStage =
  | 'legacy'
  | 'shadow'
  | 'replacement'
  | 'parked';

export type FeatureDecision =
  | 'reuse'
  | 'adapt'
  | 'rebuild'
  | 'development_only';

export interface TamamFeatureDefinition {
  readonly id: TamamFeatureId;
  readonly capability: string;
  readonly ownerModule: string;
  readonly deliveryWaves: readonly number[];
  readonly decision: FeatureDecision;
  readonly currentRoutes: readonly `/${string}`[];
  /** Only top-level destinations belong in generated primary navigation. */
  readonly primaryNavigation?: boolean;
  /** Added only when a replacement route exists and has its own E2E coverage. */
  readonly replacementRoute?: `/${string}`;
  readonly defaultStage: FeatureCutoverStage;
}

/**
 * Stored in the pull-only platform configuration document. It is deliberately
 * structurally simple so the legacy db-types layer does not depend on a domain
 * module while ADR 0003's migration is still in progress.
 */
export interface FeatureCatalogConfig {
  readonly baselineId: typeof TAMAM_REFERENCE_BASELINE_ID;
  readonly mode: FeatureCatalogMode;
  readonly cutovers: Partial<Record<TamamFeatureId, FeatureCutoverStage>>;
}

export interface ResolvedFeature {
  readonly definition: TamamFeatureDefinition;
  readonly stage: FeatureCutoverStage;
  readonly source: 'current' | 'replacement' | 'none';
  readonly route: `/${string}` | null;
  readonly visibleInPrimaryNavigation: boolean;
  readonly shadowEnabled: boolean;
}
