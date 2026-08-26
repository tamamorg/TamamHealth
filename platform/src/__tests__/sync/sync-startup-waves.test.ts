/**
 * The two-wave replication startup.
 *
 * ~75 replications starting at once front-load their checkpoint reads and
 * first pulls onto the browser's ~6-connections-per-host budget in the exact
 * seconds the landing screen loads its own data. The first wave is the
 * clinical core; the tail starts SECOND_WAVE_DELAY_MS later — or immediately
 * on an explicit syncNow(). These tests pin the partition, not the timing.
 */

import {
  AUDIT_PRUNE_MIN_INTERVAL_MS,
  CLEAN_POINT_MIN_INTERVAL_MS,
  PRIORITY_SYNC_DATABASES,
  SECOND_WAVE_DELAY_MS,
} from '@/lib/sync/sync-manager';
import { DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';
import fs from 'node:fs';
import path from 'node:path';

describe('the priority set', () => {
  it('names only databases that actually exist in the sync map', () => {
    const known = new Set(DATABASE_SYNC_CONFIGS.map(c => c.localName));
    for (const name of PRIORITY_SYNC_DATABASES) {
      expect({ name, known: known.has(name) }).toEqual({ name, known: true });
    }
  });

  it('covers the stores every landing page reads first', () => {
    for (const name of [
      'tamamhealth_patients', 'tamamhealth_appointments', 'tamamhealth_triage',
      'tamamhealth_prescriptions', 'tamamhealth_organizations', 'tamamhealth_platform_config',
    ]) {
      expect({ name, prioritized: PRIORITY_SYNC_DATABASES.has(name) })
        .toEqual({ name, prioritized: true });
    }
  });

  it('is a genuine subset — the stagger only matters if a real tail exists', () => {
    const tail = DATABASE_SYNC_CONFIGS.filter(c => !PRIORITY_SYNC_DATABASES.has(c.localName));
    expect(tail.length).toBeGreaterThan(20);
    expect(PRIORITY_SYNC_DATABASES.size).toBeLessThan(DATABASE_SYNC_CONFIGS.length / 2);
  });
});

describe('the delay', () => {
  it('is long enough to clear first paint and short enough to go unnoticed', () => {
    expect(SECOND_WAVE_DELAY_MS).toBeGreaterThanOrEqual(5_000);
    expect(SECOND_WAVE_DELAY_MS).toBeLessThanOrEqual(60_000);
  });

  it('throttles whole-database clean-point and retention bookkeeping', () => {
    expect(CLEAN_POINT_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
    expect(AUDIT_PRUNE_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe('login startup', () => {
  it('does not immediately bypass the stagger with a manual full sync', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/context.tsx'), 'utf8');
    expect(source).toContain('manager.startAll();');
    expect(source).not.toMatch(/manager\.startAll\(\);\s*(?:\/\/[^\n]*\n\s*)*manager\.syncNow\(/);
  });
});
