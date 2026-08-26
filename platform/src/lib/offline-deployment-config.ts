/**
 * Offline deployment capabilities.
 *
 * A browser cache and a facility edge node solve different outages. Keep the
 * profile explicit so Settings and production validation never describe a
 * device-only install as a shared, facility-wide offline system.
 */

export type OfflineDeploymentMode = 'device' | 'facility-edge';

export interface OfflineDeploymentConfig {
  mode: OfflineDeploymentMode;
  patientRouteLimit: number;
  cachePatientWorkspaces: boolean;
  requirePersistentStorage: boolean;
  relationshipAuthorization: boolean;
}

const DEFAULT_PATIENT_ROUTE_LIMIT = 500;
const MAX_PATIENT_ROUTE_LIMIT = 2_000;

function trueUnlessFalse(value: string | undefined): boolean {
  return value !== 'false';
}

export function readOfflineDeploymentConfig(
  env: Record<string, string | undefined> = process.env,
): OfflineDeploymentConfig {
  const mode: OfflineDeploymentMode = env.NEXT_PUBLIC_OFFLINE_DEPLOYMENT_MODE === 'facility-edge'
    ? 'facility-edge'
    : 'device';
  const requestedLimit = Number(env.NEXT_PUBLIC_OFFLINE_PATIENT_ROUTE_LIMIT);
  const patientRouteLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_PATIENT_ROUTE_LIMIT)
    : DEFAULT_PATIENT_ROUTE_LIMIT;

  return {
    mode,
    patientRouteLimit,
    cachePatientWorkspaces: trueUnlessFalse(env.NEXT_PUBLIC_OFFLINE_CACHE_PATIENT_ROUTES),
    requirePersistentStorage: mode === 'facility-edge'
      || env.NEXT_PUBLIC_OFFLINE_REQUIRE_PERSISTENT_STORAGE === 'true',
    relationshipAuthorization: env.OFFLINE_GATEWAY_RELATIONSHIP_AUTHORIZATION !== 'false',
  };
}

export function facilityEdgeConfigurationProblems(
  env: Record<string, string | undefined>,
): string[] {
  const config = readOfflineDeploymentConfig(env);
  if (config.mode !== 'facility-edge') return [];

  const problems: string[] = [];
  if (env.NEXT_PUBLIC_SYNC_ENABLED === 'false') problems.push('synchronization is disabled');
  if (env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED !== 'true') problems.push('the same-origin CouchDB gateway is disabled');
  if (env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED !== 'true') problems.push('tenant databases are disabled');
  if (env.PHI_AT_REST_STRATEGY !== 'disk-encryption') problems.push('disk/volume encryption is not attested');
  if (env.PHI_ENCRYPTION_ENABLED === 'true') problems.push('server-only field encryption is incompatible with browser offline reads');
  if (env.OFFLINE_GATEWAY_RELATIONSHIP_AUTHORIZATION === 'false') problems.push('gateway relationship authorization is disabled');
  if (!env.NEXT_PUBLIC_APP_URL) {
    problems.push('the facility LAN application URL is unset');
  } else {
    try {
      const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
      if (appUrl.protocol !== 'https:') problems.push('the facility LAN application URL is not HTTPS');
      if (env.NEXT_PUBLIC_COUCHDB_URL) {
        const couchUrl = new URL(env.NEXT_PUBLIC_COUCHDB_URL);
        if (couchUrl.origin !== appUrl.origin || !couchUrl.pathname.startsWith('/api/couch')) {
          problems.push('browser replication does not use the facility same-origin gateway');
        }
      }
    } catch {
      problems.push('the facility LAN application or CouchDB URL is invalid');
    }
  }
  if (env.NEXT_PUBLIC_OFFLINE_CACHE_PATIENT_ROUTES === 'false') problems.push('patient workspace caching is disabled');
  return problems;
}
