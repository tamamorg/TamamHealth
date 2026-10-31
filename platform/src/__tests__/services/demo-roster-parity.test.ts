/**
 * @jest-environment node
 *
 * The browser seed (lib/db-seed.ts) and the server auth roster
 * (identity/core/seed-credentials.ts) must derive from ONE roster. If they
 * drift, an account shows but cannot sign in, or signs in with no seeded data.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

process.env.SEED_CREDENTIALS_SECRET = 'jest-seed-secret-0123456789abcdef0123456789abcdef';

describe('demo roster parity', () => {
  test('server roster is the shared roster, member for member', async () => {
    const shared = await import('@/lib/seed-demo-roster');
    const server = await import('@/modules/identity/core/seed-credentials');
    expect(server.DEMO_USER_PROFILES).toBe(shared.DEMO_USER_PROFILES);
    expect(shared.DEMO_USER_PROFILES.length).toBeGreaterThan(20);
  });

  test('usernames are unique', async () => {
    const { DEMO_USER_PROFILES } = await import('@/lib/seed-demo-roster');
    const names = DEMO_USER_PROFILES.map(p => p.username);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every rostered username gets a credential, and nothing else does', async () => {
    const { DEMO_USER_PROFILES } = await import('@/lib/seed-demo-roster');
    const { getOrCreateSeedCredentials } = await import('@/modules/identity/core/seed-credentials');
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    const creds = await getOrCreateSeedCredentials();
    expect(Object.keys(creds.passwords).sort()).toEqual(DEMO_USER_PROFILES.map(p => p.username).sort());
  });

  test('db-seed consumes the shared roster and defines no roster of its own', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/lib/db-seed.ts'), 'utf8');
    expect(src).toMatch(/DEMO_USER_PROFILES[^;]*from '\.\/seed-demo-roster'/);
    expect(src).toMatch(/defaultUsers[^=]*=\s*DEMO_USER_PROFILES/);
    expect(src).not.toMatch(/\{\s*username:\s*'/);
  });
});
