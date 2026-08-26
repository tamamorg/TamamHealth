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

  it('fails closed when facility-edge mode is only partially configured', () => {
    const env = validEnvironment();
    env.NEXT_PUBLIC_OFFLINE_DEPLOYMENT_MODE = 'facility-edge';
    expect(validateProductionConfig(env).join('\n')).toMatch(/disk\/volume encryption/);

    env.PHI_AT_REST_STRATEGY = 'disk-encryption';
    env.PHI_ENCRYPTION_ENABLED = 'false';
    delete env.PHI_ENCRYPTION_KEY;
    env.NEXT_PUBLIC_OFFLINE_CACHE_PATIENT_ROUTES = 'true';
    env.OFFLINE_GATEWAY_RELATIONSHIP_AUTHORIZATION = 'true';
    expect(validateProductionConfig(env)).toEqual([]);
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

  it('refuses to boot with the dev master-password flag set', () => {
    // `NODE_ENV` already blocks the branch itself in a built server; this is
    // the second lock, so a production .env carrying the flag is a loud boot
    // failure rather than a quietly ignored line.
    const env = validEnvironment();
    env.SUPERADMIN_MASTER_PASSWORD = 'true';
    expect(validateProductionConfig(env).join('\n')).toMatch(/development-only master key/);

    // Anything that is not exactly 'true' is off, and passes.
    for (const value of ['false', 'TRUE', '1', '']) {
      const off = validEnvironment();
      off.SUPERADMIN_MASTER_PASSWORD = value;
      expect(validateProductionConfig(off)).toEqual([]);
    }
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

  it('allows unused payment callbacks to stay disabled', () => {
    const env = validEnvironment();
    delete env.AIRTEL_WEBHOOK_GATEWAY_VERIFIED;
    delete env.AIRTEL_WEBHOOK_SECRET;
    env.MPESA_WEBHOOK_GATEWAY_VERIFIED = 'false';
    delete env.MPESA_WEBHOOK_SECRET;
    expect(validateProductionConfig(env)).toEqual([]);
  });

  it('requires a strong secret for every enabled payment callback', () => {
    const gatewayEnv = validEnvironment();
    delete gatewayEnv.AIRTEL_WEBHOOK_SECRET;
    gatewayEnv.MPESA_WEBHOOK_SECRET = 'short';
    const gatewayErrors = validateProductionConfig(gatewayEnv).join('\n');
    expect(gatewayErrors).toMatch(/AIRTEL_WEBHOOK_SECRET/);
    expect(gatewayErrors).toMatch(/MPESA_WEBHOOK_SECRET/);

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

// ── Demo mode may not run on top of a real datastore ────────────────────────
describe('demo mode is a carve-out, not a production mode', () => {
  /**
   * `NEXT_PUBLIC_DEMO_MODE=true` waives the PHI-at-rest requirement, skips
   * every production warning, and switches on the patient portal's demo
   * fallback — nine routes that answer with fabricated clinical data when
   * CouchDB is briefly unreachable.
   *
   * The Aug 2026 audit found nothing asserted it was off in production: the
   * only thing keeping the combination out was a hardcoded build-arg in one
   * workflow. These pin the rule that replaced it — demo mode is legal only
   * where there is no datastore to misrepresent, which is the same pair
   * `isStandaloneDemo()` already tests before authenticating a seeded account.
   */
  const realDeployment = validEnvironment;  // already carries CouchDB credentials

  it('refuses to boot when demo mode is on and CouchDB is configured', () => {
    const errors = validateProductionConfig({ ...realDeployment(), NEXT_PUBLIC_DEMO_MODE: 'true' });
    expect(errors.join(' ')).toMatch(/NEXT_PUBLIC_DEMO_MODE=true with CouchDB credentials/);
  });

  it('still allows the standalone demo, which has no datastore', () => {
    const env = { ...validEnvironment(), NEXT_PUBLIC_DEMO_MODE: 'true' };
    delete (env as Record<string, unknown>).COUCHDB_ADMIN_USER;
    delete (env as Record<string, unknown>).COUCHDB_ADMIN_PASSWORD;
    delete (env as Record<string, unknown>).COUCHDB_USER;
    delete (env as Record<string, unknown>).COUCHDB_PASSWORD;
    const errors = validateProductionConfig(env);
    expect(errors.join(' ')).not.toMatch(/NEXT_PUBLIC_DEMO_MODE=true with CouchDB credentials/);
  });

  it('leaves a normal production deployment alone', () => {
    const errors = validateProductionConfig(realDeployment());
    expect(errors.join(' ')).not.toMatch(/NEXT_PUBLIC_DEMO_MODE/);
  });
});

// ── An optional integration must never be able to take down the EHR ─────────
describe('optional integrations are not boot-critical unless enabled', () => {
  /**
   * This is the rule, not the instance. Production refused to boot for a day
   * because `AIRTEL_/MPESA_WEBHOOK_GATEWAY_VERIFIED=true` was required
   * unconditionally — a clinic that takes no mobile money lost its entire
   * record system over a payment integration nobody had configured, and the
   * deploy that would have fixed it could not verify itself either.
   *
   * Every optional third-party integration gets a line here. Adding one that
   * fails this test means it can do the same thing again.
   */
  const OPTIONAL_INTEGRATIONS = ['AIRTEL_WEBHOOK', 'MPESA_WEBHOOK', 'FLUTTERWAVE'];

  it.each(OPTIONAL_INTEGRATIONS)('%s is silent when unconfigured', prefix => {
    const env = validEnvironment();
    for (const key of Object.keys(env)) {
      if (key.startsWith(prefix)) delete (env as Record<string, unknown>)[key];
    }
    const errors = validateProductionConfig(env).join(' ');
    expect(errors).not.toMatch(new RegExp(prefix));
  });

  /**
   * The distinction that makes the rule above safe to state.
   *
   * Shared Redis is NOT an optional integration — without it the JWT
   * revocation list is per-instance, so a logged-out token stays valid on
   * other replicas. That genuinely is boot-critical. What keeps it from being
   * the Airtel bug is the escape hatch: an operator running exactly one
   * replica can say so, explicitly, and boot.
   *
   * That is the shape any new hard requirement should take — a demand plus a
   * documented way to satisfy it, never a demand a correct deployment cannot
   * meet.
   */
  it('shared Redis is required, but offers an explicit acknowledgement path', () => {
    const env = validEnvironment();
    delete env.UPSTASH_REDIS_REST_URL;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    expect(validateProductionConfig(env).join(' ')).toMatch(/UPSTASH/);

    expect(validateProductionConfig({ ...env, SINGLE_REPLICA_ACK: 'true' })).toEqual([]);
  });
});
