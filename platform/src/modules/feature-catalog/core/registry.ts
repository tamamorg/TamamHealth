import type { TamamFeatureDefinition, TamamFeatureId } from './types';

const feature = (
  definition: TamamFeatureDefinition,
): TamamFeatureDefinition => Object.freeze(definition);

/**
 * Exact feature boundary from the pinned external reference distribution.
 * Routes describe today's Tamam surface; replacementRoute is intentionally
 * absent until a replacement has shipped behind tests.
 */
export const TAMAM_FEATURE_REGISTRY: Readonly<Record<TamamFeatureId, TamamFeatureDefinition>> = Object.freeze({
  'active-visits': feature({ id: 'active-visits', capability: 'Active visits', ownerModule: 'visits', deliveryWaves: [3, 6], decision: 'adapt', currentRoutes: ['/dashboard', '/facility-overview'], defaultStage: 'legacy' }),
  appointments: feature({ id: 'appointments', capability: 'Appointments and calendar', ownerModule: 'scheduling', deliveryWaves: [6], decision: 'adapt', currentRoutes: ['/appointments'], primaryNavigation: true, defaultStage: 'legacy' }),
  'bed-management': feature({ id: 'bed-management', capability: 'Bed administration', ownerModule: 'inpatient', deliveryWaves: [6], decision: 'adapt', currentRoutes: ['/wards'], primaryNavigation: true, defaultStage: 'legacy' }),
  billing: feature({ id: 'billing', capability: 'Patient billing', ownerModule: 'revenue', deliveryWaves: [8], decision: 'adapt', currentRoutes: ['/payments', '/billing'], primaryNavigation: true, defaultStage: 'legacy' }),
  'cohort-builder': feature({ id: 'cohort-builder', capability: 'Cohort builder', ownerModule: 'cohorts', deliveryWaves: [5], decision: 'rebuild', currentRoutes: [], defaultStage: 'legacy' }),
  devtools: feature({ id: 'devtools', capability: 'Developer tools', ownerModule: 'platform', deliveryWaves: [0], decision: 'development_only', currentRoutes: [], defaultStage: 'parked' }),
  dispensing: feature({ id: 'dispensing', capability: 'Medication dispensing', ownerModule: 'medications', deliveryWaves: [7], decision: 'adapt', currentRoutes: ['/pharmacy'], primaryNavigation: true, defaultStage: 'legacy' }),
  'fast-data-entry': feature({ id: 'fast-data-entry', capability: 'Fast data entry', ownerModule: 'forms', deliveryWaves: [5], decision: 'rebuild', currentRoutes: ['/dashboard/data-entry'], primaryNavigation: true, defaultStage: 'legacy' }),
  'form-builder': feature({ id: 'form-builder', capability: 'Form builder', ownerModule: 'forms', deliveryWaves: [5], decision: 'rebuild', currentRoutes: [], defaultStage: 'legacy' }),
  'form-engine': feature({ id: 'form-engine', capability: 'Metadata-driven form engine', ownerModule: 'forms', deliveryWaves: [5], decision: 'rebuild', currentRoutes: [], defaultStage: 'legacy' }),
  'generic-patient-widgets': feature({ id: 'generic-patient-widgets', capability: 'Generic observation widgets', ownerModule: 'observations', deliveryWaves: [3, 5], decision: 'rebuild', currentRoutes: [], defaultStage: 'legacy' }),
  'help-menu': feature({ id: 'help-menu', capability: 'Contextual help', ownerModule: 'platform', deliveryWaves: [9], decision: 'rebuild', currentRoutes: [], defaultStage: 'legacy' }),
  home: feature({ id: 'home', capability: 'Home dashboard', ownerModule: 'platform', deliveryWaves: [9], decision: 'reuse', currentRoutes: ['/dashboard'], primaryNavigation: true, defaultStage: 'legacy' }),
  'implementer-tools': feature({ id: 'implementer-tools', capability: 'Implementer tools', ownerModule: 'clinical-metadata', deliveryWaves: [1, 8], decision: 'rebuild', currentRoutes: ['/system-admin'], defaultStage: 'legacy' }),
  laboratory: feature({ id: 'laboratory', capability: 'Laboratory workflow', ownerModule: 'diagnostics', deliveryWaves: [7], decision: 'adapt', currentRoutes: ['/lab'], primaryNavigation: true, defaultStage: 'legacy' }),
  login: feature({ id: 'login', capability: 'Authentication entry', ownerModule: 'identity', deliveryWaves: [2], decision: 'reuse', currentRoutes: ['/login'], defaultStage: 'legacy' }),
  'metadata-export': feature({ id: 'metadata-export', capability: 'Metadata export', ownerModule: 'clinical-metadata', deliveryWaves: [8], decision: 'rebuild', currentRoutes: [], defaultStage: 'legacy' }),
  'open-concept-lab': feature({ id: 'open-concept-lab', capability: 'Open Concept Lab integration', ownerModule: 'clinical-metadata', deliveryWaves: [8], decision: 'rebuild', currentRoutes: [], defaultStage: 'legacy' }),
  'patient-allergies': feature({ id: 'patient-allergies', capability: 'Patient allergies', ownerModule: 'conditions', deliveryWaves: [4], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-attachments': feature({ id: 'patient-attachments', capability: 'Patient attachments', ownerModule: 'patients', deliveryWaves: [3, 5], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-banner': feature({ id: 'patient-banner', capability: 'Patient banner', ownerModule: 'patients', deliveryWaves: [2, 3], decision: 'reuse', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-chart': feature({ id: 'patient-chart', capability: 'Patient chart', ownerModule: 'patients', deliveryWaves: [3], decision: 'reuse', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-conditions': feature({ id: 'patient-conditions', capability: 'Conditions and diagnoses', ownerModule: 'conditions', deliveryWaves: [4], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-flags': feature({ id: 'patient-flags', capability: 'Patient flags', ownerModule: 'conditions', deliveryWaves: [4], decision: 'adapt', currentRoutes: ['/admin/flags', '/patients'], defaultStage: 'legacy' }),
  'patient-forms': feature({ id: 'patient-forms', capability: 'Patient forms', ownerModule: 'forms', deliveryWaves: [5], decision: 'rebuild', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-growth-chart': feature({ id: 'patient-growth-chart', capability: 'Growth charts', ownerModule: 'observations', deliveryWaves: [3, 5], decision: 'rebuild', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-immunizations': feature({ id: 'patient-immunizations', capability: 'Immunization history', ownerModule: 'conditions', deliveryWaves: [3, 4], decision: 'adapt', currentRoutes: ['/immunizations', '/patients'], defaultStage: 'legacy' }),
  'patient-label-printing': feature({ id: 'patient-label-printing', capability: 'Patient label and summary printing', ownerModule: 'patients', deliveryWaves: [2], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-list-management': feature({ id: 'patient-list-management', capability: 'Patient-list management', ownerModule: 'cohorts', deliveryWaves: [5], decision: 'rebuild', currentRoutes: ['/patients'], primaryNavigation: true, defaultStage: 'legacy' }),
  'patient-lists': feature({ id: 'patient-lists', capability: 'Patient lists in chart', ownerModule: 'cohorts', deliveryWaves: [5], decision: 'rebuild', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-medications': feature({ id: 'patient-medications', capability: 'Patient medications', ownerModule: 'medications', deliveryWaves: [4], decision: 'adapt', currentRoutes: ['/patients', '/pharmacy'], defaultStage: 'legacy' }),
  'patient-notes': feature({ id: 'patient-notes', capability: 'Patient notes', ownerModule: 'visits', deliveryWaves: [3], decision: 'reuse', currentRoutes: ['/notes', '/patients'], defaultStage: 'legacy' }),
  'patient-orders': feature({ id: 'patient-orders', capability: 'Patient orders', ownerModule: 'orders', deliveryWaves: [4], decision: 'rebuild', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-programs': feature({ id: 'patient-programs', capability: 'Patient programs', ownerModule: 'programs', deliveryWaves: [5], decision: 'rebuild', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-registration': feature({ id: 'patient-registration', capability: 'Patient registration', ownerModule: 'patients', deliveryWaves: [2], decision: 'adapt', currentRoutes: ['/patients/new'], defaultStage: 'legacy' }),
  'patient-search': feature({ id: 'patient-search', capability: 'Patient search', ownerModule: 'patients', deliveryWaves: [2], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-task-list': feature({ id: 'patient-task-list', capability: 'Patient task list', ownerModule: 'tasks', deliveryWaves: [3], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-tests': feature({ id: 'patient-tests', capability: 'Patient test results', ownerModule: 'diagnostics', deliveryWaves: [4, 7], decision: 'adapt', currentRoutes: ['/patients', '/lab'], defaultStage: 'legacy' }),
  'patient-vitals': feature({ id: 'patient-vitals', capability: 'Vitals and biometrics', ownerModule: 'observations', deliveryWaves: [3], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'patient-procedures': feature({ id: 'patient-procedures', capability: 'Patient procedures', ownerModule: 'orders', deliveryWaves: [4], decision: 'adapt', currentRoutes: ['/patients'], defaultStage: 'legacy' }),
  'primary-navigation': feature({ id: 'primary-navigation', capability: 'Primary navigation', ownerModule: 'platform', deliveryWaves: [9], decision: 'reuse', currentRoutes: ['/dashboard'], defaultStage: 'legacy' }),
  reports: feature({ id: 'reports', capability: 'Reports', ownerModule: 'reporting', deliveryWaves: [8], decision: 'rebuild', currentRoutes: ['/reports'], primaryNavigation: true, defaultStage: 'legacy' }),
  'service-queues': feature({ id: 'service-queues', capability: 'Service queues', ownerModule: 'queues', deliveryWaves: [6], decision: 'adapt', currentRoutes: ['/triage', '/rooming', '/facility-management/queue'], primaryNavigation: true, defaultStage: 'legacy' }),
  'stock-management': feature({ id: 'stock-management', capability: 'Stock management', ownerModule: 'inventory', deliveryWaves: [7], decision: 'rebuild', currentRoutes: ['/pharmacy'], primaryNavigation: true, defaultStage: 'legacy' }),
  'system-admin': feature({ id: 'system-admin', capability: 'System administration', ownerModule: 'platform', deliveryWaves: [1, 8], decision: 'rebuild', currentRoutes: ['/system-admin'], defaultStage: 'legacy' }),
  'user-onboarding': feature({ id: 'user-onboarding', capability: 'User onboarding', ownerModule: 'identity', deliveryWaves: [2, 9], decision: 'reuse', currentRoutes: ['/dashboard'], defaultStage: 'legacy' }),
  ward: feature({ id: 'ward', capability: 'Inpatient ward', ownerModule: 'inpatient', deliveryWaves: [6], decision: 'adapt', currentRoutes: ['/wards'], primaryNavigation: true, defaultStage: 'legacy' }),
});

export const TAMAM_FEATURES = Object.freeze(Object.values(TAMAM_FEATURE_REGISTRY));
