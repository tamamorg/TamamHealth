/**
 * @jest-environment node
 *
 * The reference catalog is a migration control plane. These tests make an
 * incomplete registry or an accidental global cutover a build failure.
 */
import {
  DEFAULT_FEATURE_CATALOG_CONFIG,
  TAMAM_FEATURE_IDS,
  TAMAM_FEATURE_REGISTRY,
  TAMAM_REFERENCE_BASELINE_ID,
  normalizeFeatureCatalogConfig,
  resolveFeature,
  resolvePrimaryFeatureCatalog,
} from '@/modules/feature-catalog';
import { applyFeatureCatalogToNavigation } from '@/modules/feature-catalog/client';
import fs from 'node:fs';
import path from 'node:path';

describe('the Tamam reference catalog is complete', () => {
  test('contains exactly the 47 pinned distribution features', () => {
    expect(TAMAM_FEATURE_IDS).toHaveLength(47);
    expect(Object.keys(TAMAM_FEATURE_REGISTRY).sort()).toEqual([...TAMAM_FEATURE_IDS].sort());
  });

  test('has one unique id and one delivery owner per feature', () => {
    const features = Object.values(TAMAM_FEATURE_REGISTRY);
    expect(new Set(features.map(item => item.id)).size).toBe(47);
    for (const item of features) {
      expect(item.ownerModule).not.toHaveLength(0);
      expect(item.deliveryWaves.length).toBeGreaterThan(0);
      expect(item.deliveryWaves.every(wave => Number.isInteger(wave) && wave >= 0 && wave <= 9)).toBe(true);
    }
  });

  test('does not advertise current routes that are absent from the application', () => {
    const appRoot = path.join(process.cwd(), 'src/app');
    const pages: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.name === 'page.tsx') {
          pages.push(fullPath
            .slice(appRoot.length)
            .replaceAll(path.sep, '/')
            .replace('/page.tsx', '')
            .replace(/^\/\(dashboard\)/, '') || '/');
        }
      }
    };
    visit(appRoot);

    for (const feature of Object.values(TAMAM_FEATURE_REGISTRY)) {
      for (const route of feature.currentRoutes) {
        expect(pages.some(page => page === route || page.startsWith(`${route}/`))).toBe(true);
      }
    }
  });
});

describe('catalog cutover fails closed', () => {
  test('defaults to the current catalog', () => {
    expect(DEFAULT_FEATURE_CATALOG_CONFIG).toEqual({
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_current',
      cutovers: {},
    });
    expect(resolveFeature('appointments').source).toBe('current');
    expect(resolveFeature('appointments').route).toBe('/appointments');
  });

  test('rejects a different baseline by returning the safe default', () => {
    expect(normalizeFeatureCatalogConfig({
      baselineId: 'unknown-baseline',
      mode: 'tamam_replacement',
      cutovers: { appointments: 'replacement' },
    })).toBe(DEFAULT_FEATURE_CATALOG_CONFIG);
  });

  test('drops unknown features and invalid stages', () => {
    expect(normalizeFeatureCatalogConfig({
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_shadow',
      cutovers: {
        appointments: 'shadow',
        laboratory: 'not-a-stage',
        'not-a-feature': 'replacement',
      },
    })).toEqual({
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_shadow',
      cutovers: { appointments: 'shadow' },
    });
  });

  test('cannot make a replacement primary before a replacement route exists', () => {
    const resolved = resolveFeature('appointments', {
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_replacement',
      cutovers: { appointments: 'replacement' },
    });
    expect(resolved.source).toBe('current');
    expect(resolved.route).toBe('/appointments');
    expect(resolved.shadowEnabled).toBe(false);
  });

  test('never exposes parked or not-yet-built features in primary navigation', () => {
    expect(resolveFeature('devtools').visibleInPrimaryNavigation).toBe(false);
    expect(resolveFeature('cohort-builder').visibleInPrimaryNavigation).toBe(false);
    expect(resolvePrimaryFeatureCatalog()).not.toContainEqual(
      expect.objectContaining({ definition: expect.objectContaining({ id: 'devtools' }) }),
    );
  });

  test('keeps chart extensions out of top-level navigation', () => {
    expect(resolveFeature('appointments').visibleInPrimaryNavigation).toBe(true);
    expect(resolveFeature('patient-allergies').visibleInPrimaryNavigation).toBe(false);
    expect(resolveFeature('patient-notes').visibleInPrimaryNavigation).toBe(false);
  });
});

describe('catalog-backed module navigation', () => {
  const items = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/appointments', label: 'Appointments' },
    { href: '/messages', label: 'Messages' },
  ];

  test('keeps authorized current modules and Tamam-owned routes by default', () => {
    expect(applyFeatureCatalogToNavigation(items).map(item => item.href)).toEqual([
      '/dashboard', '/appointments', '/messages',
    ]);
  });

  test('removes a parked module without granting or disturbing unrelated routes', () => {
    expect(applyFeatureCatalogToNavigation(items, {
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_current',
      cutovers: { appointments: 'parked' },
    }).map(item => item.href)).toEqual(['/dashboard', '/messages']);
  });

  test('does not navigate to a replacement that has no shipped route', () => {
    expect(applyFeatureCatalogToNavigation(items, {
      baselineId: TAMAM_REFERENCE_BASELINE_ID,
      mode: 'tamam_replacement',
      cutovers: { appointments: 'replacement' },
    }).map(item => item.href)).toContain('/appointments');
  });
});
