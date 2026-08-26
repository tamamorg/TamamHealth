import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, unauthorized } from '@/modules/identity';
import {
  facilityEdgeConfigurationProblems,
  readOfflineDeploymentConfig,
} from '@/lib/offline-deployment-config';

export const dynamic = 'force-dynamic';

async function edgeDatabaseReachable(): Promise<boolean> {
  const base = process.env.COUCHDB_URL?.replace(/\/+$/, '');
  const username = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const password = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!base || !username || !password) return false;
  try {
    const response = await fetch(`${base}/_up`, {
      headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const auth = await getAuthPayload(request);
  if (!auth) return unauthorized();

  const config = readOfflineDeploymentConfig(process.env);
  const problems = facilityEdgeConfigurationProblems(process.env);
  const databaseReachable = config.mode === 'facility-edge'
    ? await edgeDatabaseReachable()
    : false;

  return NextResponse.json({
    mode: config.mode,
    patientRouteLimit: config.patientRouteLimit,
    cachePatientWorkspaces: config.cachePatientWorkspaces,
    requirePersistentStorage: config.requirePersistentStorage,
    facilityEdgeReady: config.mode === 'facility-edge' && problems.length === 0 && databaseReachable,
    databaseReachable,
    tenantIsolation: process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED === 'true',
    sameOriginGateway: process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED === 'true',
    relationshipAuthorization: config.relationshipAuthorization,
    atRestProtection: process.env.PHI_AT_REST_STRATEGY === 'disk-encryption',
    problems,
  }, { headers: { 'cache-control': 'no-store' } });
}
