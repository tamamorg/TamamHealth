function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}


/** Build the per-request CSP used by the Next.js proxy. */
export function buildContentSecurityPolicy(input: {
  nonce: string;
  isDev: boolean;
  couchdbUrl?: string;
  posthogHost?: string;
  /**
   * Whether this response is going out over HTTPS.
   *
   * Decides `upgrade-insecure-requests`, which was emitted unconditionally.
   * On an HTTP origin that directive rewrites every absolute `http://` URL the
   * app is configured with to `https://` — including
   * `NEXT_PUBLIC_COUCHDB_URL`, which is how the browser reaches the sync
   * gateway. On a plain-HTTP deployment (local development, and any clinic
   * server behind a terminating proxy that forwards as HTTP) every replication
   * request became `https://…` against a listener that speaks no TLS and died
   * as `ERR_SSL_PROTOCOL_ERROR`. Replication then failed silently: the app
   * still worked, because it reads its own PouchDB, and nothing reached the
   * server.
   *
   * Defaults to true, so a deployment that forgets to pass it keeps the
   * hardening rather than losing it.
   */
  isSecureOrigin?: boolean;
}): string {
  if (!/^[A-Za-z0-9+/_=-]+$/.test(input.nonce)) {
    throw new Error('CSP nonce contains invalid characters');
  }
  const connectOrigins = new Set([
    "'self'",
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
  ]);
  for (const candidate of [input.couchdbUrl, input.posthogHost]) {
    const origin = safeOrigin(candidate);
    if (origin) connectOrigins.add(origin);
  }

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'${input.isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${Array.from(connectOrigins).join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  // Only meaningful on an HTTPS origin, and actively harmful on an HTTP one.
  if (input.isSecureOrigin !== false) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
