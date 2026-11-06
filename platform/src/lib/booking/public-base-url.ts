/**
 * Trusted origin for the public booking pages' server-side fetches to their own
 * API.
 *
 * The /book/* pages are public, so the request `Host` header is attacker
 * controlled. Building the fetch URL from it was a server-side request forgery:
 * a `/` or `?` injected into `Host` chose the request path too, turning the
 * confirm page into a 2xx-JSON oracle for internal services (CouchDB on
 * localhost, cloud metadata, …). Use the deployment's own configured address
 * instead. Production boot requires NEXT_PUBLIC_APP_URL (config-validation);
 * dev falls back to loopback, never to the request header.
 */
export function publicBookingOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `http://127.0.0.1:${process.env.PORT?.trim() || '3000'}`;
}
