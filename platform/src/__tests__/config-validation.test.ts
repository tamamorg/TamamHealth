import { validateProductionConfig, type ConfigEnv } from '@/lib/config-validation';

function validEnvironment(): ConfigEnv {
  return {
    JWT_SECRET: 'jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    PHI_ENCRYPTION_ENABLED: 'true',
    PHI_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    NEXT_PUBLIC_DEMO_MODE: 'false',
    NEXT_PUBLIC_CLEAR_SEEDED_DATA_ONCE: 'false',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'redis-token',
    NEXT_PUBLIC_SYNC_ENABLED: 'true',
    NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED: 'true',
    NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED: 'true',
    NEXT_PUBLIC_COUCHDB_URL: 'https://v7.example.invalid/api/couch',
    NEXT_PUBLIC_APP_URL: 'https://v7.example.invalid',
    COUCHDB_URL: 'http://10.114.0.3:5984',
    COUCHDB_ADMIN_USER: 'admin',
    COUCHDB_ADMIN_PASSWORD: 'couch-admin-secret-0123456789',
    SUPERADMIN_INITIAL_PASSWORD: 'sa-strong-secret-0123456789',
    COUCHDB_GATEWAY_SECRET: 'gateway-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    COUCHDB_WEBHOOK_SECRET: 'webhook-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    AIRTEL_WEBHOOK_SECRET: 'airtel-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    MPESA_WEBHOOK_SECRET: 'mpesa-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  };
}

describe('production configuration validation', () => {
  it('accepts the private CouchDB gateway topology', () => {
    expect(validateProductionConfig(validEnvironment())).toEqual([]);
  });

  it('rejects a missing, default, or weak SUPERADMIN_INITIAL_PASSWORD', () => {
    const missing = validEnvironment();
    delete missing.SUPERADMIN_INITIAL_PASSWORD;
    expect(validateProductionConfig(missing).join('\n')).toMatch(/SUPERADMIN_INITIAL_PASSWORD must be set/);

    const isDefault = validEnvironment();
    isDefault.SUPERADMIN_INITIAL_PASSWORD = 'Superadmin!';
    expect(validateProductionConfig(isDefault).join('\n')).toMatch(/demo default or a placeholder/);

    const weak = validEnvironment();
    weak.SUPERADMIN_INITIAL_PASSWORD = 'short';
    expect(validateProductionConfig(weak).join('\n')).toMatch(/at least 16 characters/);
  });

  it('requires tenant databases and a same-origin browser gateway', () => {
    const env = validEnvironment();
    env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED = 'false';
    env.NEXT_PUBLIC_COUCHDB_URL = 'https://couch.example.invalid';
    const errors = validateProductionConfig(env).join('\n');
    expect(errors).toMatch(/database-per-organization/);
    expect(errors).toMatch(/same app origin/);
  });

  it('rejects placeholder or weak database and webhook credentials', () => {
    const env = validEnvironment();
    env.COUCHDB_ADMIN_PASSWORD = 'REPLACE-this-password';
    env.COUCHDB_GATEWAY_SECRET = 'REPLACE-this-gateway-secret-that-is-long-enough';
    env.AIRTEL_WEBHOOK_SECRET = 'short';
    const errors = validateProductionConfig(env).join('\n');
    expect(errors).toMatch(/COUCHDB_ADMIN_PASSWORD/);
    expect(errors).toMatch(/COUCHDB_GATEWAY_SECRET/);
    expect(errors).toMatch(/AIRTEL_WEBHOOK_SECRET/);
  });
});
