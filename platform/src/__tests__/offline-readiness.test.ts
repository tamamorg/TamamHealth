import {
  buildOfflineReadinessReport,
  type OfflineReadinessSignals,
} from '@/lib/offline-readiness';

const READY: OfflineReadinessSignals = {
  secureContext: true,
  serviceWorkerActive: true,
  appShellCached: true,
  localDatabaseAvailable: true,
  offlineSignInAvailable: true,
  durableStorage: true,
};

describe('offline readiness', () => {
  it('declares a fully provisioned device ready for a cold offline start', () => {
    const report = buildOfflineReadinessReport(READY, '2026-08-26T12:00:00.000Z');
    expect(report).toMatchObject({
      state: 'ready',
      canColdStartOffline: true,
      checkedAt: '2026-08-26T12:00:00.000Z',
    });
    expect(report.checks.every(check => check.passed)).toBe(true);
  });

  it.each([
    'secureContext',
    'serviceWorkerActive',
    'appShellCached',
    'localDatabaseAvailable',
    'offlineSignInAvailable',
  ] as const)('refuses readiness when %s is missing', signal => {
    const report = buildOfflineReadinessReport({ ...READY, [signal]: false });
    expect(report.state).toBe('not-ready');
    expect(report.canColdStartOffline).toBe(false);
  });

  it('warns, but can still cold-start, when storage remains evictable', () => {
    const report = buildOfflineReadinessReport({ ...READY, durableStorage: false });
    expect(report.state).toBe('warning');
    expect(report.canColdStartOffline).toBe(true);
    expect(report.checks.find(check => check.id === 'durable-storage')).toMatchObject({
      required: false,
      passed: false,
    });
  });
});
