'use client';

import type { DataScope } from './services/data-scope';
import { readOfflineDeploymentConfig } from './offline-deployment-config';

/**
 * A measurable answer to "can this device cold-start with no internet?"
 *
 * PouchDB being present is necessary but not sufficient. The browser also
 * needs an active worker, a complete cached shell, durable local storage and
 * a previously provisioned sign-in. Keep those checks together so deployment
 * teams can verify a device before it leaves connectivity.
 */

export type OfflineReadinessCheckId =
  | 'secure-context'
  | 'service-worker'
  | 'app-shell'
  | 'offline-pack'
  | 'local-database'
  | 'offline-sign-in'
  | 'durable-storage';

export interface OfflineReadinessCheck {
  id: OfflineReadinessCheckId;
  required: boolean;
  passed: boolean;
}

export type OfflineReadinessState = 'ready' | 'warning' | 'not-ready';

export interface OfflineReadinessReport {
  state: OfflineReadinessState;
  canColdStartOffline: boolean;
  checks: OfflineReadinessCheck[];
  checkedAt: string;
  pack: {
    buildVersion: string | null;
    provisionedPaths: number;
    failedPaths: string[];
  };
}

export interface OfflineReadinessSignals {
  secureContext: boolean;
  serviceWorkerActive: boolean;
  appShellCached: boolean;
  offlinePackReady: boolean;
  localDatabaseAvailable: boolean;
  offlineSignInAvailable: boolean;
  durableStorage: boolean;
  durableStorageRequired?: boolean;
}

/** Pure report builder, separated from browser APIs for regression tests. */
export function buildOfflineReadinessReport(
  signals: OfflineReadinessSignals,
  checkedAt = new Date().toISOString(),
  pack: OfflineReadinessReport['pack'] = { buildVersion: null, provisionedPaths: 0, failedPaths: [] },
): OfflineReadinessReport {
  const checks: OfflineReadinessCheck[] = [
    { id: 'secure-context', required: true, passed: signals.secureContext },
    { id: 'service-worker', required: true, passed: signals.serviceWorkerActive },
    { id: 'app-shell', required: true, passed: signals.appShellCached },
    { id: 'offline-pack', required: true, passed: signals.offlinePackReady },
    { id: 'local-database', required: true, passed: signals.localDatabaseAvailable },
    { id: 'offline-sign-in', required: true, passed: signals.offlineSignInAvailable },
    // A browser may refuse persistence even when every other prerequisite is
    // healthy. The device can work offline, but unsynced work remains at risk
    // of automatic eviction under storage pressure, hence warning not failure.
    { id: 'durable-storage', required: signals.durableStorageRequired === true, passed: signals.durableStorage },
  ];
  const requiredReady = checks.filter(check => check.required).every(check => check.passed);
  const allReady = checks.every(check => check.passed);
  return {
    state: !requiredReady ? 'not-ready' : allReady ? 'ready' : 'warning',
    canColdStartOffline: requiredReady,
    checks,
    checkedAt,
    pack,
  };
}

interface OfflineManifest {
  buildVersion?: string;
  shellReady?: boolean;
  provisionedPaths?: string[];
  failedPaths?: string[];
}

const OFFLINE_MANIFEST_URL = '/__tamamhealth_offline_manifest__';

async function readCurrentOfflineManifest(): Promise<OfflineManifest | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
    const cache = await caches.open(`tamamhealth-${buildId}`);
    const response = await cache.match(OFFLINE_MANIFEST_URL);
    if (!response) return null;
    const manifest = await response.json() as OfflineManifest;
    return manifest.buildVersion === buildId ? manifest : null;
  } catch {
    return null;
  }
}

async function hasActiveServiceWorker(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return Boolean(navigator.serviceWorker.controller || registration?.active);
  } catch {
    return false;
  }
}

async function hasLocalClinicalDatabase(): Promise<boolean> {
  try {
    const { getDB } = await import('./db');
    await getDB('tamamhealth_patients').info();
    return true;
  } catch {
    return false;
  }
}

async function hasDurableStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

async function hasProvisionedOfflineSignIn(username?: string): Promise<boolean> {
  try {
    const { hasOfflineCredential } = await import('@/modules/identity/core/offline-credential');
    return hasOfflineCredential(username);
  } catch {
    return false;
  }
}

/**
 * Inspect the current browser without changing data. Safe to run repeatedly
 * from Settings after deployment or before a field device goes offline.
 */
export async function assessOfflineReadiness(
  username?: string,
  requiredPaths: readonly string[] = [],
): Promise<OfflineReadinessReport> {
  const deployment = readOfflineDeploymentConfig();
  const [serviceWorkerActive, manifest, localDatabaseAvailable, offlineSignInAvailable, durableStorage] =
    await Promise.all([
      hasActiveServiceWorker(),
      readCurrentOfflineManifest(),
      hasLocalClinicalDatabase(),
      hasProvisionedOfflineSignIn(username),
      hasDurableStorage(),
    ]);

  const provisioned = new Set(manifest?.provisionedPaths ?? []);
  const provisionedRequiredPaths = requiredPaths.filter(path => provisioned.has(path));
  const offlinePackReady = requiredPaths.length > 0
    && requiredPaths.every(path => provisioned.has(path));

  return buildOfflineReadinessReport({
    secureContext: typeof window !== 'undefined' && window.isSecureContext,
    serviceWorkerActive,
    appShellCached: manifest?.shellReady === true,
    offlinePackReady,
    localDatabaseAvailable,
    offlineSignInAvailable,
    durableStorage,
    durableStorageRequired: deployment.requirePersistentStorage,
  }, undefined, {
    buildVersion: manifest?.buildVersion ?? null,
    provisionedPaths: provisionedRequiredPaths.length,
    failedPaths: manifest?.failedPaths ?? [],
  });
}

export interface OfflinePackResult {
  ok: boolean;
  provisionedPaths: string[];
  failedPaths: string[];
  buildVersion?: string;
}

/**
 * Add exact dynamic chart documents for patients already authorized and
 * replicated to this device. Next.js dynamic navigations cannot safely reuse a
 * different patient's HTML shell, so the service worker caches each pathname.
 */
export async function collectPatientWorkspacePaths(scope: DataScope): Promise<string[]> {
  const config = readOfflineDeploymentConfig();
  if (!config.cachePatientWorkspaces) return [];
  try {
    const { getAllPatients } = await import('./services/patient-service');
    const patients = await getAllPatients(scope);
    return patients
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, config.patientRouteLimit)
      .map(patient => `/patients/${encodeURIComponent(patient._id)}`);
  } catch {
    return [];
  }
}

/** Ask the active worker to cache and verify the signed-in role's routes. */
export async function provisionOfflinePack(paths: readonly string[]): Promise<OfflinePackResult> {
  const deployment = readOfflineDeploymentConfig();
  if (deployment.requirePersistentStorage && typeof navigator !== 'undefined' && navigator.storage?.persist) {
    // Browsers may require this call from a user gesture. Provisioning is
    // initiated by the Settings button, so this is the correct moment to ask.
    await navigator.storage.persist().catch(() => false);
  }
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return { ok: false, provisionedPaths: [], failedPaths: [...paths] };
  }
  const registration = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
  const worker = navigator.serviceWorker.controller || registration?.active;
  if (!worker) return { ok: false, provisionedPaths: [], failedPaths: [...paths] };
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      resolve({ ok: false, provisionedPaths: [], failedPaths: [...paths] });
    }, 120_000);
    channel.port1.onmessage = event => {
      window.clearTimeout(timeout);
      channel.port1.close();
      const result = event.data as Partial<OfflinePackResult>;
      resolve({
        ok: result.ok === true,
        provisionedPaths: Array.isArray(result.provisionedPaths) ? result.provisionedPaths : [],
        failedPaths: Array.isArray(result.failedPaths) ? result.failedPaths : [...paths],
        buildVersion: result.buildVersion,
      });
    };
    worker.postMessage(
      { type: 'PREPARE_OFFLINE', paths: [...new Set(paths)] },
      [channel.port2],
    );
  });
}
