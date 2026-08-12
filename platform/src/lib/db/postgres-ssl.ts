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

/**
 * node-postgres lets SSL query parameters in a connection URL replace the
 * separately supplied `ssl` object. That silently discards a managed
 * provider's CA and produces "self-signed certificate in certificate chain".
 * Once we have explicit SSL options, remove those URL parameters so the
 * verified configuration remains authoritative.
 */
export function connectionStringForExplicitSsl(
  connectionString: string,
  ssl: PostgresSslOptions | undefined,
): string {
  if (!ssl) return connectionString;

  const url = new URL(connectionString);
  for (const parameter of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    url.searchParams.delete(parameter);
  }
  return url.toString();
}
