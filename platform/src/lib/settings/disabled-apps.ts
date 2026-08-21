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
 * Navigation only. It is a configuration choice about what a tenant has bought
 * or turned on, NOT an access control: `lib/role-routes.ts` and the Edge proxy
 * remain the security boundary, and a disabled app's route still refuses
 * anyone whose role was never allowed there. Someone who types the URL of a
 * disabled-but-permitted app still gets in — which is the right behaviour for
 * a module toggle, and the reason this must never be relied on as a gate.
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
export function isAppDisabled(href: string): boolean {
  if (!href || disabledRoutes.length === 0) return false;
  const path = href.split('?')[0];
  return disabledRoutes.some(route => path === route || path.startsWith(`${route}/`));
}
