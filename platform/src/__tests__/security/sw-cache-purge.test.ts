/**
 * @jest-environment node
 *
 * Security audit 2026-11 L3: signing out purges cached authenticated pages but
 * keeps the public sign-in shell and static chunks.
 */
import { purgeServiceWorkerCaches, isShellRequest } from '@/lib/security/sw-cache-purge';

const ORIGIN = 'http://localhost';

class FakeCache {
  store = new Map<string, Response | string>();
  async keys() { return [...this.store.keys()].map(url => ({ url })) as unknown as Request[]; }
  async delete(req: { url: string }) { return this.store.delete(req.url); }
  async match(url: string) {
    const v = this.store.get(`${ORIGIN}${url}`);
    return typeof v === 'string' ? new Response(v) : undefined;
  }
  async put(url: string, res: Response) { this.store.set(url.startsWith('http') ? url : `${ORIGIN}${url}`, await res.text()); }
}

describe('isShellRequest', () => {
  it('keeps the sign-in shell and static assets, drops everything else', () => {
    for (const keep of ['/login', '/manifest.json', '/_next/static/chunks/a.js', '/assets/x.svg', '/icons/icon-192.svg', '/__tamamhealth_offline_manifest__']) {
      expect(isShellRequest(`${ORIGIN}${keep}`)).toBe(true);
    }
    for (const drop of ['/', '/dashboard', '/patients/abc', '/referrals?patient=p1', '/login?next=/patients/1', '/dashboard?_rsc=1']) {
      expect(isShellRequest(`${ORIGIN}${drop}`)).toBe(false);
    }
  });
});

describe('purgeServiceWorkerCaches', () => {
  it('deletes authenticated routes, keeps the shell, resets the provisioned list', async () => {
    const app = new FakeCache();
    const other = new FakeCache();
    const manifest = JSON.stringify({ buildVersion: 'b', shellReady: true, provisionedPaths: ['/patients/p1'], failedPaths: ['/x'] });
    for (const path of ['/login', '/patients/p1', '/referrals?patient=p1', '/_next/static/a.js', '/dashboard']) {
      app.store.set(`${ORIGIN}${path}`, 'body');
    }
    app.store.set(`${ORIGIN}/__tamamhealth_offline_manifest__`, manifest);
    other.store.set(`${ORIGIN}/patients/p2`, 'body');
    const all: Record<string, FakeCache> = { 'tamamhealth-b1': app, 'tamamhealth-b0': other, 'unrelated': new FakeCache() };
    (globalThis as unknown as { caches: unknown }).caches = {
      keys: async () => Object.keys(all),
      open: async (name: string) => all[name],
    };

    const { deleted } = await purgeServiceWorkerCaches();
    expect(deleted).toBe(4);
    expect([...app.store.keys()].sort()).toEqual([
      `${ORIGIN}/__tamamhealth_offline_manifest__`,
      `${ORIGIN}/_next/static/a.js`,
      `${ORIGIN}/login`,
    ]);
    expect(other.store.size).toBe(0);
    const rewritten = JSON.parse(app.store.get(`${ORIGIN}/__tamamhealth_offline_manifest__`) as string);
    expect(rewritten.shellReady).toBe(true);
    expect(rewritten.provisionedPaths).toEqual([]);
    delete (globalThis as { caches?: unknown }).caches;
  });

  it('is a no-op where CacheStorage is missing', async () => {
    delete (globalThis as { caches?: unknown }).caches;
    await expect(purgeServiceWorkerCaches()).resolves.toEqual({ deleted: 0 });
  });
});
