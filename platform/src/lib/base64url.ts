/**
 * Environment-neutral base64url (RFC 4648 section 5, unpadded) helpers.
 * Uses btoa/atob only, so it works in browsers, the Edge runtime and Node 16+.
 */

export function base64UrlFromBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesFromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
