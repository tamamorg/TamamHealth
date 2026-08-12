export interface PostgresSslOptions {
  rejectUnauthorized: true;
  ca?: string;
}

/**
 * Strict PostgreSQL TLS configuration for production.
 *
 * Managed providers such as DigitalOcean issue a cluster-specific CA. Vercel
 * stores it base64-encoded so multiline PEM formatting cannot be corrupted by
 * the environment-variable UI. Providers using a public CA can omit it and
 * Node's normal trust store is used.
 */
export function postgresSslOptions(
  env: Record<string, string | undefined> = process.env,
): PostgresSslOptions | undefined {
  const encodedCa = env.DATABASE_CA_CERT_BASE64;
  if (env.NODE_ENV !== 'production' && !encodedCa) return undefined;

  if (!encodedCa) return { rejectUnauthorized: true };
  const ca = Buffer.from(encodedCa, 'base64').toString('utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('DATABASE_CA_CERT_BASE64 does not decode to a PEM certificate');
  }
  return { rejectUnauthorized: true, ca };
}
