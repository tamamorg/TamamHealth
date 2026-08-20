/**
 * @jest-environment node
 *
 * Room naming and join links.
 *
 * Two people "in the same visit" who cannot see each other is the hardest
 * telehealth bug to diagnose in the field, and it comes from exactly one
 * place: the provider side and the patient side deriving different room names.
 * These pin that derivation, and the shape of the links handed out.
 */

import {
  roomNameForSession,
  providerIdentity,
  patientIdentity,
  buildPatientJoinUrl,
  buildProviderJoinUrl,
  isLiveKitConfigured,
} from '@/lib/telehealth-room';

const BASE = 'https://app.tamamhealth.org';

describe('room naming', () => {
  test('both sides of a visit derive the same room from the session id', () => {
    expect(roomNameForSession('tele-appt-apt-1')).toBe(roomNameForSession('tele-appt-apt-1'));
  });

  test('different sessions never share a room', () => {
    expect(roomNameForSession('tele-appt-apt-1')).not.toBe(roomNameForSession('tele-appt-apt-2'));
  });

  test('provider and patient identities are distinguishable', () => {
    // LiveKit keys participants by identity; a collision would let one leg of
    // the call evict the other.
    expect(providerIdentity('u-1')).not.toBe(patientIdentity('u-1'));
    expect(providerIdentity('u-1')).toContain('provider');
    expect(patientIdentity('p-1')).toContain('patient');
  });
});

describe('join links', () => {
  test('neither link carries a token', () => {
    // A forwarded SMS or a screenshot must grant nothing on its own; tokens are
    // minted per request at /api/telehealth/token after authentication.
    const patient = buildPatientJoinUrl('tele-appt-apt-1', BASE);
    const provider = buildProviderJoinUrl('apt-1', BASE)!;
    for (const url of [patient, provider]) {
      expect(url).not.toMatch(/token|jwt|secret/i);
    }
  });

  test('the patient link carries the SESSION id', () => {
    // /telehealth/join/[sessionId] looks the session up directly.
    expect(buildPatientJoinUrl('tele-appt-apt-1', BASE))
      .toBe(`${BASE}/telehealth/join/tele-appt-apt-1`);
  });

  test('the provider link carries the APPOINTMENT id', () => {
    // The bug this pins: the provider URL was built from the session id while
    // /telehealth/visit/[appointmentId] resolves its visit out of the
    // appointment list, so the link landed on a page that found nothing. It
    // went unnoticed only because the stored providerJoinUrl had no readers —
    // the first feature to use it would have been the one to discover it.
    expect(buildProviderJoinUrl('apt-1', BASE))
      .toBe(`${BASE}/telehealth/visit/apt-1`);
  });

  test('a walk-in has no provider link rather than a broken one', () => {
    // Walk-ins carry no appointment, and `/telehealth/visit/undefined` is worse
    // than no link at all.
    expect(buildProviderJoinUrl(undefined, BASE)).toBeNull();
    expect(buildProviderJoinUrl('', BASE)).toBeNull();
  });

  test('ids are URL-encoded', () => {
    expect(buildPatientJoinUrl('a/b?c', BASE)).toBe(`${BASE}/telehealth/join/a%2Fb%3Fc`);
    expect(buildProviderJoinUrl('a/b?c', BASE)).toBe(`${BASE}/telehealth/visit/a%2Fb%3Fc`);
  });

  test('a trailing slash on the base does not double up', () => {
    expect(buildPatientJoinUrl('s-1', 'https://app.example.org/'))
      .toBe('https://app.example.org/telehealth/join/s-1');
  });
});

describe('configuration detection', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('all three parts are required', () => {
    process.env.LIVEKIT_API_KEY = 'k';
    process.env.LIVEKIT_API_SECRET = 's';
    delete process.env.LIVEKIT_URL;
    delete process.env.NEXT_PUBLIC_LIVEKIT_URL;
    // Partial config must read as unconfigured, so the token route answers a
    // clear 503 instead of failing to sign with a confusing error.
    expect(isLiveKitConfigured()).toBe(false);

    process.env.LIVEKIT_URL = 'wss://livekit.example.org';
    expect(isLiveKitConfigured()).toBe(true);
  });

  test('the public URL alone satisfies the URL requirement', () => {
    process.env.LIVEKIT_API_KEY = 'k';
    process.env.LIVEKIT_API_SECRET = 's';
    delete process.env.LIVEKIT_URL;
    process.env.NEXT_PUBLIC_LIVEKIT_URL = 'wss://livekit.example.org';
    expect(isLiveKitConfigured()).toBe(true);
  });

  test('no key or secret is unconfigured however good the URL', () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    process.env.LIVEKIT_URL = 'wss://livekit.example.org';
    expect(isLiveKitConfigured()).toBe(false);
  });
});
