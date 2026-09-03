import { resolveFeature } from './cutover';
import { TAMAM_FEATURES } from './registry';
type NavigationEntry = { readonly href: string };
type FeatureCatalogInput = {
  readonly baselineId?: unknown;
  readonly mode?: unknown;
  readonly cutovers?: unknown;
} | null;

const basePath = (href: string): string => href.split('?')[0].split('#')[0];

/**
 * Applies catalog cutovers to an already-authorized navigation list.
 *
 * Authorization deliberately happens before this function. The catalog may
 * hide or replace a route, but it can never grant a route that the user's role
 * did not already have. Routes outside the catalog are Tamam-owned modules and
 * pass through unchanged.
 */
export function applyFeatureCatalogToNavigation<T extends NavigationEntry>(
  items: readonly T[],
  config?: FeatureCatalogInput,
  canNavigate: (href: string) => boolean = href => items.some(item => basePath(item.href) === basePath(href)),
): T[] {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const item of items) {
    const path = basePath(item.href);
    const matchingFeatures = TAMAM_FEATURES.filter(feature =>
      feature.primaryNavigation === true && feature.currentRoutes.includes(path as `/${string}`),
    );

    let next = item;
    if (matchingFeatures.length > 0) {
      const visible = matchingFeatures
        .map(feature => resolveFeature(feature.id, config))
        .filter(state => state.visibleInPrimaryNavigation && state.route);
      if (visible.length === 0) continue;

      const replacement = visible.find(state => state.source === 'replacement');
      // A replacement has its own authorization check. Passing RBAC for the
      // current route must never grant a newly introduced path implicitly.
      if (replacement?.route && replacement.route !== path && canNavigate(replacement.route)) {
        next = { ...item, href: replacement.route };
      }
    }

    const key = basePath(next.href);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(next);
  }

  return output;
}
