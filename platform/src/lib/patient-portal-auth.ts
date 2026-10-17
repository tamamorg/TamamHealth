/**
 * Patient Portal API authentication helper.
 * Verifies JWT tokens issued to patients by /api/patient-portal/login.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from './rate-limit';
import { SignJWT, jwtVerify } from 'jose';
import { resolveJwtSecret } from '@/modules/identity/edge';

// Shares JWT_SECRET resolution + production refusal with auth-token.ts so the
// patient portal can't accidentally run with the hardcoded default.
const JWT_SECRET = new TextEncoder().encode(resolveJwtSecret());

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
  /** Issued-at, unix seconds (standard JWT claim). */
  iat?: number;
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
  let payload: PatientTokenPayload;
  try {
    const verified = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    payload = verified.payload as unknown as PatientTokenPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const throttled = await guardPortalFloor(payload.sub);
  if (throttled) return throttled;
  const dead = await rejectIfPortalSessionRevoked(payload);
  return dead ?? payload;
}

/**
 * The shared live check every authenticated portal request passes through.
 *
 * A portal JWT is valid for hours and renewable for a day, and was trusted on
 * signature alone: suspending the portal account, or the patient choosing a new
 * password, changed nothing about a token already in someone's hand. The
 * patient document is therefore authoritative on every request:
 *
 *  - the patient must still exist,
 *  - `portalDisabledAt` must be unset (suspension takes effect immediately), and
 *  - the token must have been issued at or after the last credential change
 *    (`portalCredentialEpoch`, stamped when the password is set or access is
 *    suspended). The check tolerates the field being absent.
 *
 * Fails closed when the patient store is unreachable, except on a demo
 * deployment (no CouchDB by design), where the signed token stays the truth.
 */
export async function rejectIfPortalSessionRevoked(
  payload: Pick<PatientTokenPayload, 'sub' | 'iat'>,
): Promise<NextResponse | null> {
  const revoked = () => NextResponse.json({ error: 'Session is no longer valid. Please sign in again.' }, { status: 401 });
  try {
    const { patientsDB } = await import('./db');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patient = await (patientsDB() as any).get(payload.sub) as {
      portalDisabledAt?: string; portalCredentialEpoch?: string;
    };
    if (patient.portalDisabledAt) return revoked();
    if (patient.portalCredentialEpoch) {
      const epochSec = Math.floor(Date.parse(patient.portalCredentialEpoch) / 1000);
      if (Number.isFinite(epochSec) && (typeof payload.iat !== 'number' || payload.iat < epochSec)) return revoked();
    }
    return null;
  } catch (err) {
    const e = err as { status?: number; name?: string } | undefined;
    if (e && (e.status === 404 || e.name === 'not_found')) return revoked();
    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return null;
    return NextResponse.json({ error: 'Session could not be verified.' }, { status: 503 });
  }
}

/**
 * Stamp the credential epoch on a patient: every portal token issued before
 * now stops working. Call when a portal password is set or access suspended.
 * Best-effort conflict retry; never throws into the caller's success path.
 */
export async function stampPortalCredentialEpoch(patientId: string): Promise<void> {
  try {
    const { patientsDB } = await import('./db');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = patientsDB() as any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const doc = await db.get(patientId);
        await db.put({ ...doc, portalCredentialEpoch: new Date().toISOString() });
        return;
      } catch (err) {
        if ((err as { status?: number } | undefined)?.status !== 409) return;
      }
    }
  } catch {
    // demo / no store -- nothing to stamp
  }
}

/**
 * The floor every portal request passes through.
 *
 * `/patient-portal/login`, `/verify-otp` and `/refresh` were rate limited —
 * somebody reasoned carefully about credential brute-force — and the eleven
 * routes behind them were not. So a token, once obtained, could read a
 * patient's records, labs, prescriptions, immunisations and bills as fast as
 * the network allowed.
 *
 * Token theft is the realistic threat here rather than a forged session: the
 * portal is used on shared phones, and `PATIENT_SESSION_MAX_SECONDS` already
 * exists because a stolen token surviving forever was a known concern. A limit
 * does not prevent theft; it bounds what one stolen token can drain before the
 * 24-hour cap forces re-authentication.
 *
 * Keyed on the PATIENT, not the IP — an attacker holding a token can change
 * address freely, and the thing worth bounding is access to one person's
 * record.
 *
 * Deliberately generous. A portal page load hits several endpoints at once and
 * a patient may refresh; this is set well above any human pattern so it never
 * fires for a real session, and still turns "unbounded" into a number.
 */
const PORTAL_FLOOR_PER_MINUTE = 120;

async function guardPortalFloor(patientId: string): Promise<NextResponse | null> {
  if (!patientId) return null;
  const verdict = await rateLimit({
    key: `portal:floor:${patientId}`,
    limit: PORTAL_FLOOR_PER_MINUTE,
    windowMs: 60_000,
  });
  if (verdict.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many requests. Please try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

/**
 * A tighter cap for the three portal endpoints that WRITE.
 *
 * The floor above bounds a scrape. This bounds the actions that reach staff —
 * an appointment request, a message into a clinician's inbox, a recorded
 * payment. Those are handfuls-per-visit actions, so the limit can be strict
 * without ever touching real use, and a scripted patient cannot fill a ward's
 * message queue.
 */
export async function guardPortalWrite(
  patientId: string,
  bucket: string,
  limit = 10,
  windowMs = 5 * 60_000,
): Promise<NextResponse | null> {
  if (!patientId) return null;
  const verdict = await rateLimit({ key: `portal:${bucket}:${patientId}`, limit, windowMs });
  if (verdict.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many requests. Please try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

/** Same stamp, addressed by portal username (the activate route only learns the username). */
export async function stampPortalCredentialEpochByUsername(username: string): Promise<void> {
  try {
    if (!username) return;
    const { patientsDB } = await import('./db');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = await (patientsDB() as any).find({ selector: { type: 'patient', portalUsername: username }, limit: 1 });
    const id = found?.docs?.[0]?._id as string | undefined;
    if (id) await stampPortalCredentialEpoch(id);
  } catch {
    // best-effort
  }
}
