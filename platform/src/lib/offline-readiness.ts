'use client';

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
}

export interface OfflineReadinessSignals {
  secureContext: boolean;
  serviceWorkerActive: boolean;
  appShellCached: boolean;
  localDatabaseAvailable: boolean;
  offlineSignInAvailable: boolean;
  durableStorage: boolean;
}

/** Pure report builder, separated from browser APIs for regression tests. */
export function buildOfflineReadinessReport(
  signals: OfflineReadinessSignals,
  checkedAt = new Date().toISOString(),
): OfflineReadinessReport {
  const checks: OfflineReadinessCheck[] = [
    { id: 'secure-context', required: true, passed: signals.secureContext },
    { id: 'service-worker', required: true, passed: signals.serviceWorkerActive },
    { id: 'app-shell', required: true, passed: signals.appShellCached },
    { id: 'local-database', required: true, passed: signals.localDatabaseAvailable },
    { id: 'offline-sign-in', required: true, passed: signals.offlineSignInAvailable },
    // A browser may refuse persistence even when every other prerequisite is
    // healthy. The device can work offline, but unsynced work remains at risk
    // of automatic eviction under storage pressure, hence warning not failure.
    { id: 'durable-storage', required: false, passed: signals.durableStorage },
  ];
  const requiredReady = checks.filter(check => check.required).every(check => check.passed);
  const allReady = checks.every(check => check.passed);
  return {
    state: !requiredReady ? 'not-ready' : allReady ? 'ready' : 'warning',
    canColdStartOffline: requiredReady,
    checks,
    checkedAt,
  };
}

async function hasCachedApplicationShell(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const login = await caches.match('/login');
    if (!login) return false;

    // HTML without its hashed JS/CSS only produces a non-interactive page.
    // Require at least one Next bootstrap asset as proof that installation
    // cached an executable shell, not just markup.
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      if (!cacheName.startsWith('tamamhealth-')) continue;
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      if (requests.some(request => {
        const pathname = new URL(request.url).pathname;
        return pathname.startsWith('/_next/static/') && /\.(?:js|css)$/.test(pathname);
      })) return true;
    }
    return false;
  } catch {
    return false;
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
export async function assessOfflineReadiness(username?: string): Promise<OfflineReadinessReport> {
  const [serviceWorkerActive, appShellCached, localDatabaseAvailable, offlineSignInAvailable, durableStorage] =
    await Promise.all([
      hasActiveServiceWorker(),
      hasCachedApplicationShell(),
      hasLocalClinicalDatabase(),
      hasProvisionedOfflineSignIn(username),
      hasDurableStorage(),
    ]);

  return buildOfflineReadinessReport({
    secureContext: typeof window !== 'undefined' && window.isSecureContext,
    serviceWorkerActive,
    appShellCached,
    localDatabaseAvailable,
    offlineSignInAvailable,
    durableStorage,
  });
}
