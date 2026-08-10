/**
 * Patient Portal API authentication helper.
 * Verifies JWT tokens issued to patients by /api/patient-portal/login.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';

// Mirrors the JWT_SECRET resolution + production refusal in lib/auth-token.ts
// so the patient portal can't accidentally run with the hardcoded default.
const HARDCODED_FALLBACK = 'tamamhealth-south-sudan-health-2026-secret-key';
const secret =
  process.env.JWT_SECRET ||
  HARDCODED_FALLBACK;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_SERVER = typeof window === 'undefined';

if (IS_SERVER && IS_PRODUCTION && secret === HARDCODED_FALLBACK) {
  throw new Error(
    '[SECURITY] JWT_SECRET environment variable must be set in production. ' +
    'Refusing to start with the default fallback secret.'
  );
}

if (IS_SERVER && IS_PRODUCTION && secret.length < 32) {
  throw new Error(
    '[SECURITY] JWT_SECRET must be at least 32 characters in production ' +
    `(got ${secret.length}). Generate one with: openssl rand -hex 32`
  );
}

const JWT_SECRET = new TextEncoder().encode(secret);

const JWT_ISSUER = 'tamamhealth';
const JWT_AUDIENCE = 'tamamhealth-patient';

export type PatientTokenPayload = {
  sub: string; // patient _id
  name: string;
  hospitalNumber: string;
  role: 'patient';
  /**
   * Session start, unix seconds. Preserved across renewals so a sliding
   * session still has an absolute ceiling (KAN-68). Optional because tokens
   * issued before renewal existed do not carry it — those are treated as
   * starting now, which is the safe direction (it cannot shorten a session
   * retroactively, only refuse to extend one indefinitely).
   */
  sst?: number;
};

/**
 * Web Crypto API availability — same fallback gate as auth-token.ts.
 * crypto.subtle is only available in secure contexts (HTTPS or localhost).
 */
function hasCryptoSubtle(): boolean {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined';
}

/**
 * Create a patient-portal JWT (audience: tamamhealth-patient, 8h expiry).
 * Mirrors createToken() in auth-token.ts so a hardcoded secret can't slip
 * back into this code path.
 */
export async function createPatientToken(payload: {
  sub: string;
  name: string;
  hospitalNumber: string;
  role: 'patient';
  /**
   * Unix seconds when this SESSION began — preserved across renewals so a
   * sliding session still has an absolute ceiling (KAN-68). Omit on a fresh
   * login; the current time is used.
   */
  sessionStart?: number;
}): Promise<string> {
  if (!hasCryptoSubtle()) {
    // Patient portal is web-only and always served over HTTPS in production;
    // refuse to issue an unsigned fallback rather than degrade silently.
    throw new Error('[SECURITY] crypto.subtle unavailable — refusing to issue patient token');
  }
  return new SignJWT({
    sub: payload.sub,
    name: payload.name,
    hospitalNumber: payload.hospitalNumber,
    role: payload.role,
    sst: payload.sessionStart ?? Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('8h')
    .sign(JWT_SECRET);
}

/**
 * Hard ceiling on a renewed session (KAN-68).
 *
 * Renewal is a sliding window: a still-valid token buys a fresh 8 hours. That
 * alone would let a STOLEN token be renewed forever, so `sst` (session start)
 * is carried through every renewal and refused past this cap. 24h covers the
 * longest realistic clinic visit — the case the ticket is about — while still
 * forcing a real re-authentication once a day.
 */
export const PATIENT_SESSION_MAX_SECONDS = 24 * 60 * 60;

/**
 * Verify the patient JWT from the Authorization header.
 * Returns the payload or a 401 NextResponse.
 */
export async function verifyPatientToken(
  req: NextRequest
): Promise<PatientTokenPayload | NextResponse> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing authorization' }, { status: 401 });
  }

  const token = auth.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as PatientTokenPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }
}
