/**
 * The public booking pages fetch their own API server-side. Building that URL
 * from the request Host header was a server-side request forgery (SECURITY-
 * AUDIT-2026-11 M1). The origin must come from configuration, never the request.
 */
import { publicBookingOrigin } from '@/lib/booking/public-base-url';

const SAVED = { url: process.env.NEXT_PUBLIC_APP_URL, port: process.env.PORT };

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = SAVED.url;
  process.env.PORT = SAVED.port;
});

it('uses the configured app URL, trimming trailing slashes', () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.tamamhealth.org/';
  expect(publicBookingOrigin()).toBe('https://app.tamamhealth.org');
});

it('falls back to loopback, never to a request-derived host', () => {
  delete process.env.NEXT_PUBLIC_APP_URL;
  process.env.PORT = '3300';
  expect(publicBookingOrigin()).toBe('http://127.0.0.1:3300');
});

it('never returns an attacker-supplied host even if one is passed around', () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.tamamhealth.org';
  // The function takes no request input at all — that is the fix.
  expect(publicBookingOrigin()).not.toContain('evil');
});
