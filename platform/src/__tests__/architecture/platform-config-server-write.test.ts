/**
 * @jest-environment node
 *
 * platform_config is a PULL-ONLY database (it is not in the push set), so the
 * server owns the canonical doc and replicates it down. A browser write to the
 * local copy never travels up: feature flags, security policies and config
 * would look changed on one device and reach no other (security/data audit
 * 2026-11-05, §2.1 #11). The admin UI's only write path, usePlatformConfig,
 * must therefore go through /api/platform-config — never the local-write
 * service helper updatePlatformConfig (which is correct ONLY server-side).
 *
 * Source-scanned because the invariant is about which write path the hook
 * takes, which the text carries exactly and no behavioural test pins cheaply
 * (there is no hook-render harness in this repo).
 */
import fs from 'node:fs';
import path from 'node:path';

const HOOK = path.resolve(__dirname, '../../lib/hooks/usePlatformConfig.ts');

describe('platform config writes go through the server', () => {
  const source = fs.readFileSync(HOOK, 'utf8');

  it('POSTs to /api/platform-config via apiFetch', () => {
    expect(source).toMatch(/apiFetch\(\s*['"]\/api\/platform-config['"]/);
    expect(source).toMatch(/method:\s*['"]POST['"]/);
  });

  it('does not take the local-write path (updatePlatformConfig) in the browser hook', () => {
    expect(source).not.toMatch(/updatePlatformConfig/);
  });

  it('platform_config is pull-only — the reason the hook must use the server', () => {
    const syncConfig = fs.readFileSync(
      path.resolve(__dirname, '../../lib/sync/sync-config.ts'), 'utf8',
    );
    // The DATABASE_SYNC_CONFIGS entry for the DB must declare direction: 'pull'.
    const entry = syncConfig
      .split('\n')
      .find(line => line.includes('tamamhealth_platform_config') && line.includes('direction'));
    expect(entry).toBeDefined();
    expect(entry).toMatch(/direction:\s*['"]pull['"]/);
  });
});
