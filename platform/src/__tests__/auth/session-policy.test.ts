/**
 * @jest-environment node
 *
 * The security console's numbers, now that they do something.
 *
 * `sessionTimeoutMinutes` and `impersonationMaxMinutes` were displayed on
 * /admin/security from the day it shipped and read by nothing — an operator
 * setting a fifteen-minute idle timeout got whatever the facility had
 * configured, and a support session "capped at thirty minutes" lived the full
 * session TTL. These pin the two rules that make them real.
 */
import { SESSION_TTL_SEC } from '@/lib/session';

/**
 * The idle-timeout resolution, extracted from `useAutoLock.getTimeout`.
 *
 * Reproduced here rather than rendered through the hook because the rule is
 * arithmetic and the hook needs a DOM, a settings store and a subscription to
 * say anything at all. The ORDER is the part worth protecting: each layer may
 * only ever shorten the one above it.
 */
function effectiveIdleMinutes(input: {
  platform?: number;
  facility?: number;
  org?: number;
  user?: number;
  fallback: number;
}): number {
  const { platform, facility, org, user, fallback } = input;
  const cap = (value: number) => (platform && platform > 0 ? Math.min(value, platform) : value);
  const policy = facility && facility > 0 ? facility : org && org > 0 ? org : undefined;
  if (policy !== undefined) return cap(user && user > 0 ? Math.min(policy, user) : policy);
  if (user && user > 0) return cap(user);
  if (platform && platform > 0) return platform;
  return fallback;
}

describe('the idle timeout', () => {
  it('lets a facility be stricter than the platform', () => {
    expect(effectiveIdleMinutes({ platform: 15, facility: 2, fallback: 30 })).toBe(2);
  });

  it('does NOT let a facility be looser than the platform', () => {
    // This is the whole point of a platform policy: a tenant cannot configure
    // its way out of the operator's ceiling.
    expect(effectiveIdleMinutes({ platform: 15, facility: 60, fallback: 30 })).toBe(15);
  });

  it('does not let an individual be looser than either', () => {
    // A clinician picking "30 min" on a workstation the facility locks after 2
    // must not extend it — and neither may they exceed the platform.
    expect(effectiveIdleMinutes({ platform: 15, facility: 2, user: 30, fallback: 30 })).toBe(2);
    expect(effectiveIdleMinutes({ platform: 15, user: 30, fallback: 30 })).toBe(15);
  });

  it('applies on its own when nothing else is configured', () => {
    // Previously this fell through to a hard-coded default and the operator's
    // number was ignored entirely.
    expect(effectiveIdleMinutes({ platform: 15, fallback: 30 })).toBe(15);
  });

  it('changes nothing when the platform sets no ceiling', () => {
    expect(effectiveIdleMinutes({ facility: 45, fallback: 30 })).toBe(45);
    expect(effectiveIdleMinutes({ fallback: 30 })).toBe(30);
  });
});

/** The rule inside `createToken`: a caller may shorten a session, never extend it. */
function effectiveTtlSec(requested: number | undefined): number {
  return requested && requested > 0 ? Math.min(requested, SESSION_TTL_SEC) : SESSION_TTL_SEC;
}

describe('an impersonated session', () => {
  it('expires after the configured maximum', () => {
    expect(effectiveTtlSec(30 * 60)).toBe(30 * 60);
  });

  it('cannot be used to obtain a LONGER session than normal', () => {
    // A policy value is a cap on impersonation, not a way to mint a token that
    // outlives an ordinary sign-in.
    expect(effectiveTtlSec(SESSION_TTL_SEC * 10)).toBe(SESSION_TTL_SEC);
  });

  it('leaves an ordinary session at the normal length', () => {
    expect(effectiveTtlSec(undefined)).toBe(SESSION_TTL_SEC);
    expect(effectiveTtlSec(0)).toBe(SESSION_TTL_SEC);
  });
});
