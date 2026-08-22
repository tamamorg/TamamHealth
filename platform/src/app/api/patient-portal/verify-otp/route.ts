import { logApiError } from '@/modules/identity';
/**
 * POST /api/patient-portal/verify-otp — second step of patient portal login
 * (KAN-76 / LOW-02).
 *
 * The login route verifies the password and, when OTP is enabled, returns
 * `{ otpRequired: true, challengeId }` WITHOUT a session token. This route
 * exchanges a correct code for that token.
 *
 * Deliberately unauthenticated in the staff sense: there is no session yet.
 * What protects it is the code itself, which only reaches the phone on the
 * patient's record, plus per-IP and per-challenge rate limits and the
 * five-attempt cap inside `verifyOtp`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/request-utils';
import { createPatientToken } from '@/lib/patient-portal-auth';
import { verifyOtp } from '@/lib/patient-portal-otp';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // Per-IP limit on top of the per-challenge attempt cap: without it, an
  // attacker could burn five attempts, trigger a fresh challenge, and repeat.
  const ipVerdict = await rateLimit({ key: `portal-otp:ip:${ip}`, limit: 20, windowMs: 15 * 60 * 1000 });
  if (!ipVerdict.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  let body: { challengeId?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const challengeId = (body.challengeId || '').trim();
  const code = (body.code || '').trim();
  if (!challengeId || !code) {
    return NextResponse.json({ error: 'Verification code is required.' }, { status: 400 });
  }

  const verdict = await verifyOtp(challengeId, code);
  if (!verdict.ok) {
    // One generic message for every failure mode. Distinguishing "expired"
    // from "wrong code" from "no such challenge" would tell an attacker
    // whether a given patient id has a login in flight.
    const status = verdict.reason === 'too-many-attempts' ? 429 : 401;
    return NextResponse.json(
      { error: 'That code is not valid or has expired. Please sign in again.' },
      { status },
    );
  }

  try {
    const { patientsDB } = await import('@/lib/db');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = patientsDB() as any;
    const patient = await db.get(challengeId);

    // "Is anyone actually using the portal we enrolled them in?" was
    // unanswerable — nothing recorded a portal sign-in. Best-effort, and never
    // in the way of a patient reaching their own records.
    const { recordPortalLogin } = await import('@/modules/identity/services/patient-portal-enrolment');
    await recordPortalLogin(patient._id);

    const token = await createPatientToken({
      sub: patient._id,
      name: `${patient.firstName} ${patient.surname}`,
      hospitalNumber: patient.hospitalNumber || '',
      role: 'patient',
    });

    // Same minimal allow-list the login route returns — the authentication
    // boundary must not carry PHI.
    return NextResponse.json({
      token,
      patient: {
        id: patient._id,
        firstName: patient.firstName,
        surname: patient.surname,
        hospitalNumber: patient.hospitalNumber || '',
        registrationHospital: patient.registrationHospital,
      },
    });
  } catch (err) {
    logApiError('[patient-portal/verify-otp]', err);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
