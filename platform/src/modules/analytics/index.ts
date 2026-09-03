/**
 * National analytics projection domain.
 *
 * The current surface is server-only: ingestion is reached through the API
 * adapter, while projection internals remain private to this module.
 */
/** Document types deliberately retained at facility level. */
export const NATIONAL_PROJECTION_EXCLUDED_TYPES: ReadonlySet<string> = new Set([
  'system_config',
  'facility_settings',
]);
