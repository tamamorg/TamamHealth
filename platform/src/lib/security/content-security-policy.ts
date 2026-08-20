function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The origins a LiveKit URL needs in `connect-src`.
 *
 * A telehealth call opens a WebSocket to the LiveKit server for signalling and
 * an HTTP request to the same host to validate the connection, so BOTH schemes
 * have to be listed — `wss://` alone is not implied by `https://` in a CSP
 * source list, and a blocked socket presents as a call that never connects with
 * only a console violation to say why.
 *
 * Returns nothing for an unset or unparseable URL: a deployment with no
 * telehealth server configured must not widen its policy for one.
 */
function liveKitOrigins(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const url = new URL(value);
    const secure = url.protocol === 'wss:' || url.protocol === 'https:';
    const insecure = url.protocol === 'ws:' || url.protocol === 'http:';
    if (!secure && !insecure) return [];
    return [
      `${secure ? 'wss' : 'ws'}://${url.host}`,
      `${secure ? 'https' : 'http'}://${url.host}`,
    ];
  } catch {
    return [];
  }
}

/** Build the per-request CSP used by the Next.js proxy. */
export function buildContentSecurityPolicy(input: {
  nonce: string;
  isDev: boolean;
  couchdbUrl?: string;
  posthogHost?: string;
  /** LiveKit signalling endpoint, if telehealth video is configured. */
  livekitUrl?: string;
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
  for (const origin of liveKitOrigins(input.livekitUrl)) connectOrigins.add(origin);

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
