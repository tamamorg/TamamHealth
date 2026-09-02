/**
 * The routes an organization has switched off in System Administration →
 * Manage Apps.
 *
 * `SystemConfigDoc.appOverrides` was written by the console and read by
 * nothing: disabling "Laboratory" flipped a toggle and left Laboratory in
 * every nav, on every device. This is the consumer that makes the toggle mean
 * something — the app's route (and everything under it) drops out of the
 * navigation for that organization.
 *
 * This drives both navigation filtering and the dashboard-shell route guard.
 * It remains a configuration choice, NOT an authorization boundary:
 * `lib/role-routes.ts` and the Edge proxy still decide what each role may open.
 */
import { SYSTEM_APP_DEFINITIONS } from '../admin/system-admin-registry';

let disabledRoutes: string[] = [];
const subscribers = new Set<(routes: string[]) => void>();

/** Recompute from an org's overrides. Called when the config doc loads. */
export function setDisabledApps(appOverrides: Record<string, boolean>): void {
  disabledRoutes = SYSTEM_APP_DEFINITIONS
    .filter(app => app.route && appOverrides[app.id] === false)
    .map(app => app.route as string);
  for (const cb of subscribers) {
    try { cb(disabledRoutes); } catch { /* isolate */ }
  }
}

/** Routes belonging to apps this organization has switched off. */
export function getDisabledAppRoutes(): string[] {
  return disabledRoutes;
}

export function subscribeDisabledApps(cb: (routes: string[]) => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}


/**
 * True when `href` belongs to a switched-off app. Prefix-matched the same way
 * `isHrefAllowed` reads a path, so disabling Laboratory also removes
 * `/lab/worklist`.
 */
export function isAppDisabled(href: string, routes: readonly string[] = disabledRoutes): boolean {
  if (!href || routes.length === 0) return false;
  const path = href.split('?')[0];
  return routes.some(route => path === route || path.startsWith(`${route}/`));
}
