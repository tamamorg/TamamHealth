import {
  facilityEdgeConfigurationProblems,
  readOfflineDeploymentConfig,
} from '@/lib/offline-deployment-config';

describe('offline deployment config', () => {
  it('defaults to bounded device-only operation', () => {
    expect(readOfflineDeploymentConfig({})).toMatchObject({
      mode: 'device',
      patientRouteLimit: 500,
      cachePatientWorkspaces: true,
      requirePersistentStorage: false,
      relationshipAuthorization: true,
    });
  });

  it('caps patient workspace provisioning', () => {
    expect(readOfflineDeploymentConfig({ NEXT_PUBLIC_OFFLINE_PATIENT_ROUTE_LIMIT: '999999' }).patientRouteLimit)
      .toBe(2_000);
  });

  it('accepts a complete facility edge and reports every missing guarantee', () => {
    const complete = {
      NEXT_PUBLIC_OFFLINE_DEPLOYMENT_MODE: 'facility-edge',
      NEXT_PUBLIC_SYNC_ENABLED: 'true',
      NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED: 'true',
      NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED: 'true',
      NEXT_PUBLIC_APP_URL: 'https://clinic.example',
      NEXT_PUBLIC_COUCHDB_URL: 'https://clinic.example/api/couch',
      NEXT_PUBLIC_OFFLINE_CACHE_PATIENT_ROUTES: 'true',
      OFFLINE_GATEWAY_RELATIONSHIP_AUTHORIZATION: 'true',
      PHI_AT_REST_STRATEGY: 'disk-encryption',
      PHI_ENCRYPTION_ENABLED: 'false',
    };
    expect(facilityEdgeConfigurationProblems(complete)).toEqual([]);
    expect(facilityEdgeConfigurationProblems({
      ...complete,
      NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED: 'false',
      PHI_AT_REST_STRATEGY: undefined,
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('gateway'),
      expect.stringContaining('encryption'),
    ]));
  });
});
