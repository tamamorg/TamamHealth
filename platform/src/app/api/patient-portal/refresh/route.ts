import { logApiError } from '@/modules/identity';
/**
 * POST /api/patient-portal/refresh — silent session renewal (KAN-68 / MED-18).
 *
 * There was no renewal path at all: an 8-hour token simply expired and the
 * next request 401'd into a hard logout. A patient reviewing their own record
 * during a long clinic visit — or on a connectivity window that opens hours
 * after they signed in — was signed out mid-read.
 *
 * ## Sliding session, not a second credential
 *
 * A classic refresh-token design issues a long-lived credential alongside the
 * access token. That means a SECOND secret to store on the device, a store to
 * revoke it in, and a new theft surface — for a patient portal whose access
 * token already lives in SecureStore, that is more risk and more moving parts
 * than the problem needs.
 *
 * Instead a still-valid token buys a fresh one. The security cost of that is
 * that a stolen token could be renewed indefinitely, so every token carries
 * `sst` (session start), preserved across renewals and refused past
 * PATIENT_SESSION_MAX_SECONDS. The session slides, but it cannot slide forever.
 *
 * An EXPIRED token is not renewable — `verifyPatientToken` rejects it. Renewal
 * extends a live session; it does not resurrect a dead one.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  createPatientToken,
  verifyPatientToken,
  PATIENT_SESSION_MAX_SECONDS,
} from '@/lib/patient-portal-auth';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-utils';

export async function POST(req: NextRequest) {
  // A renewal loop is cheap to run and would mint tokens as fast as it asked.
  const ip = getClientIp(req);
  const verdict = await rateLimit({ key: `portal-refresh:${ip}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!verdict.allowed) {
    return NextResponse.json({ error: 'Too many refresh attempts.' }, { status: 429 });
  }

  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth; // 401 — expired or invalid.

  const nowSec = Math.floor(Date.now() / 1000);
  const sessionStart = typeof auth.sst === 'number' ? auth.sst : nowSec;

  if (nowSec - sessionStart >= PATIENT_SESSION_MAX_SECONDS) {
    // Deliberately distinguishable from a plain 401 so the client can show
    // "your session has ended, please sign in again" rather than implying
    // something went wrong.
    return NextResponse.json(
      { error: 'Session expired. Please sign in again.', reason: 'session-max-age' },
      { status: 401 },
    );
  }

  try {
    const token = await createPatientToken({
      sub: auth.sub,
      name: auth.name,
      hospitalNumber: auth.hospitalNumber || '',
      role: 'patient',
      sessionStart, // carried through, so the ceiling above still applies
    });
    return NextResponse.json({ token });
  } catch (err) {
    logApiError('[patient-portal/refresh]', err);
    return NextResponse.json({ error: 'Could not refresh the session' }, { status: 500 });
  }
}
