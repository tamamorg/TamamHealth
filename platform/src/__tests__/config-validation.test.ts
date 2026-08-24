import { productionConfigWarnings, validateProductionConfig, type ConfigEnv } from '@/lib/config-validation';

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
    AIRTEL_WEBHOOK_GATEWAY_VERIFIED: 'true',
    // A correct production deployment sends mail. Left unset, the provider
    // falls back to "log" and every invitation and password-reset link is
    // written to the container log instead of being delivered — so this
    // fixture, which stands for a fully-valid environment, has to set it.
    EMAIL_PROVIDER: 'sendgrid',
    SENDGRID_API_KEY: 'SG.test-key-0123456789',
    MPESA_WEBHOOK_SECRET: 'mpesa-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    MPESA_WEBHOOK_GATEWAY_VERIFIED: 'true',
  };
}

describe('production configuration validation', () => {
  it('accepts the private CouchDB gateway topology', () => {
    expect(validateProductionConfig(validEnvironment())).toEqual([]);
  });

  it('accepts disk-encryption as the declared at-rest strategy (offline-first)', () => {
    const env = validEnvironment();
    // Option A: full-disk/volume encryption, no field-level key on the app.
    delete env.PHI_ENCRYPTION_ENABLED;
    delete env.PHI_ENCRYPTION_KEY;
    env.PHI_AT_REST_STRATEGY = 'disk-encryption';
    expect(validateProductionConfig(env)).toEqual([]);
  });

  it('fails closed when no at-rest strategy is declared', () => {
    const env = validEnvironment();
    delete env.PHI_ENCRYPTION_ENABLED;
    delete env.PHI_ENCRYPTION_KEY;
    // No PHI_AT_REST_STRATEGY either.
    expect(validateProductionConfig(env).join('\n')).toMatch(/PHI at-rest protection must be declared/);
  });

  it('still validates the field key when field encryption is switched on', () => {
    const env = validEnvironment();
    env.PHI_AT_REST_STRATEGY = 'disk-encryption';
    env.PHI_ENCRYPTION_ENABLED = 'true';
    env.PHI_ENCRYPTION_KEY = 'too-short';
    expect(validateProductionConfig(env).join('\n')).toMatch(/PHI_ENCRYPTION_KEY must decode/);
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

  it('requires provider verification for every enabled payment callback', () => {
    const gatewayEnv = validEnvironment();
    delete gatewayEnv.AIRTEL_WEBHOOK_GATEWAY_VERIFIED;
    gatewayEnv.MPESA_WEBHOOK_GATEWAY_VERIFIED = 'false';
    const gatewayErrors = validateProductionConfig(gatewayEnv).join('\n');
    expect(gatewayErrors).toMatch(/AIRTEL_WEBHOOK_GATEWAY_VERIFIED/);
    expect(gatewayErrors).toMatch(/MPESA_WEBHOOK_GATEWAY_VERIFIED/);

    const flutterwaveEnv = validEnvironment();
    flutterwaveEnv.FLUTTERWAVE_SECRET_HASH = 'flutterwave-hash-0123456789-abcdefghijklmnopqrstuvwxyz';
    const flutterwaveErrors = validateProductionConfig(flutterwaveEnv).join('\n');
    expect(flutterwaveErrors).toMatch(/FLUTTERWAVE_SECRET_KEY/);

    flutterwaveEnv.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-0123456789-abcdefghijklmnopqrstuvwxyz';
    expect(validateProductionConfig(flutterwaveEnv)).toEqual([]);
  });
});

/**
 * Warnings are the deployment problems that must not refuse boot — a clinic
 * losing its platform because a dashboard is unconfigured is worse than the
 * gap itself. They are printed on every start instead, so the gap stays a
 * decision someone keeps making rather than one nobody knows about.
 */
describe('production configuration warnings', () => {
  it('warns when nothing is collecting server errors', () => {
    const env = validEnvironment();
    // Production ran for months with no error sink: a provisioning conflict
    // that silently cost clinicians their replication was visible only to
    // someone reading container logs by hand.
    expect(productionConfigWarnings(env)).toEqual([expect.stringContaining('SENTRY_DSN')]);
  });

  it('warns when no email provider is configured', () => {
    // The failure mode is silent and total: onboarding appears to work, the
    // link is logged rather than sent, and nobody outside the server ever
    // receives it. That is worth a warning even though it is not fatal.
    const env: ConfigEnv = { ...validEnvironment(), SENTRY_DSN: 'https://x@sentry.invalid/1' };
    delete env.EMAIL_PROVIDER;
    delete env.SENDGRID_API_KEY;
    expect(productionConfigWarnings(env)).toEqual([expect.stringContaining('EMAIL_PROVIDER')]);
  });

  it('warns when a provider is named but its key is missing', () => {
    const env: ConfigEnv = { ...validEnvironment(), SENTRY_DSN: 'https://x@sentry.invalid/1' };
    delete env.SENDGRID_API_KEY;
    expect(productionConfigWarnings(env)).toEqual([expect.stringContaining('SENDGRID_API_KEY')]);
  });

  it('is satisfied by either the server or the public DSN', () => {
    expect(productionConfigWarnings({ ...validEnvironment(), SENTRY_DSN: 'https://x@sentry.invalid/1' })).toEqual([]);
    expect(productionConfigWarnings({ ...validEnvironment(), NEXT_PUBLIC_SENTRY_DSN: 'https://x@sentry.invalid/1' })).toEqual([]);
  });

  it('says nothing about a demo deployment', () => {
    // A demo has no real errors worth paging anyone about.
    expect(productionConfigWarnings({ ...validEnvironment(), NEXT_PUBLIC_DEMO_MODE: 'true' })).toEqual([]);
  });

  it('never duplicates something validation already refuses boot over', () => {
    // The shared-store gap is already a hard error unless SINGLE_REPLICA_ACK
    // records the choice. Warning about it too would train operators to ignore
    // the warning block.
    const noRedis: ConfigEnv = { ...validEnvironment(), SINGLE_REPLICA_ACK: 'true' };
    delete noRedis.UPSTASH_REDIS_REST_URL;
    delete noRedis.UPSTASH_REDIS_REST_TOKEN;
    expect(productionConfigWarnings(noRedis).join(' ')).not.toMatch(/redis/i);
  });
});
