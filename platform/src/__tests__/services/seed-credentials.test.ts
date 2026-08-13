/**
 * @jest-environment node
 *
 * seed-credentials — the platform super-admin's INITIAL password.
 *
 * 'superadmin' must exist in every mode with the fixed initial password
 * (override: SUPERADMIN_INITIAL_PASSWORD). The password is initial-only —
 * it lands as a bcrypt hash on the seeded user doc and is changed through
 * the normal change-password flow.
 *
 * Tests run in deterministic mode (SEED_CREDENTIALS_SECRET set) so no
 * credentials file is read or written.
 */

export {};

const BASE_ENV = process.env;

async function loadCredentials(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...BASE_ENV, SEED_CREDENTIALS_SECRET: 'jest-seed-secret-0123456789abcdef0123456789abcdef', ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
  }
  const { getOrCreateSeedCredentials } = await import('@/lib/seed-credentials');
  return getOrCreateSeedCredentials();
}

afterAll(() => {
  process.env = BASE_ENV;
});

describe('superadmin initial password', () => {
  test('production mode seeds superadmin with the fixed default', async () => {
    const creds = await loadCredentials({ NEXT_PUBLIC_DEMO_MODE: 'false', SUPERADMIN_INITIAL_PASSWORD: undefined });
    expect(creds.passwords.superadmin).toBe('Superadmin!');
    // The bootstrap admin is still seeded alongside it.
    expect(creds.passwords.admin).toBeTruthy();
  });

  test('SUPERADMIN_INITIAL_PASSWORD overrides the default', async () => {
    const creds = await loadCredentials({ NEXT_PUBLIC_DEMO_MODE: 'false', SUPERADMIN_INITIAL_PASSWORD: 'Rotated#12345678' });
    expect(creds.passwords.superadmin).toBe('Rotated#12345678');
  });

  test('demo mode pins the same initial password', async () => {
    const creds = await loadCredentials({ NEXT_PUBLIC_DEMO_MODE: 'true', SUPERADMIN_INITIAL_PASSWORD: undefined });
    expect(creds.passwords.superadmin).toBe('Superadmin!');
  });

  test('other users still get deterministic per-user passwords', async () => {
    const creds = await loadCredentials({ NEXT_PUBLIC_DEMO_MODE: 'true', SUPERADMIN_INITIAL_PASSWORD: undefined });
    expect(creds.passwords['nurse.stella']).toBeTruthy();
    expect(creds.passwords['nurse.stella']).not.toBe(creds.passwords['lab.gatluak']);
  });
});
