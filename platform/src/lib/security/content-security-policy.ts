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

  return [
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
    'upgrade-insecure-requests',
  ].join('; ');
}
