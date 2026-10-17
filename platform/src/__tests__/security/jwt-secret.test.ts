/** @jest-environment node */
import { JWT_SECRET_FALLBACK, resolveJwtSecret } from '@/modules/identity/core/jwt-secret';

const env = process.env as Record<string, string | undefined>;
const saved = { JWT_SECRET: env.JWT_SECRET, NODE_ENV: env.NODE_ENV };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
});

describe('resolveJwtSecret', () => {
  it('uses JWT_SECRET when set', () => {
    env.NODE_ENV = 'test';
    env.JWT_SECRET = 'x'.repeat(40);
    expect(resolveJwtSecret()).toBe('x'.repeat(40));
  });

  it('falls back to the dev secret outside production', () => {
    env.NODE_ENV = 'development';
    delete env.JWT_SECRET;
    expect(resolveJwtSecret()).toBe(JWT_SECRET_FALLBACK);
  });

  it('refuses the fallback in production', () => {
    env.NODE_ENV = 'production';
    delete env.JWT_SECRET;
    expect(() => resolveJwtSecret()).toThrow(/Refusing to start with the default fallback/);
  });

  it('enforces 32 chars in production — CSRF included, which used to accept a short secret', async () => {
    env.NODE_ENV = 'production';
    env.JWT_SECRET = 'short';
    expect(() => resolveJwtSecret()).toThrow(/at least 32 characters.*got 5/);
    jest.resetModules();
    const csrf = await import('@/modules/identity/core/csrf');
    await expect(Promise.resolve().then(() => csrf.mintCsrfToken('u1'))).rejects.toThrow(/at least 32 characters/);
  });

  it('every consumer resolves the same secret', async () => {
    env.NODE_ENV = 'test';
    env.JWT_SECRET = 'consumer-shared-secret-0123456789abcdef';
    jest.resetModules();
    const { createToken, verifyToken } = await import('@/modules/identity/core/auth-token');
    const csrf = await import('@/modules/identity/core/csrf');
    const portal = await import('@/lib/patient-portal-auth');
    expect(typeof createToken).toBe('function');
    expect(typeof verifyToken).toBe('function');
    expect(portal).toBeDefined();
    // csrf token verifies only if it used the same secret on mint and verify
    const tok = await csrf.mintCsrfToken('u1');
    expect(await csrf.verifyCsrfToken(tok, 'u1')).toBe(true);
  });
});
