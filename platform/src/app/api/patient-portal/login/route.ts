import { logApiError, verifyPassword } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/request-utils';
import { createPatientToken } from '@/lib/patient-portal-auth';
import { demoFallbackEnabled, logDemoFallback, findDemoPatientByUsername } from '@/lib/patient-portal-demo';

import { otpEnabled, issueOtp } from '@/lib/patient-portal-otp';
import { rateLimit, resetRateLimit } from '@/lib/rate-limit';

// Shared rate limit: 10 attempts / 15 min / IP + 10 attempts / 15 min /
// account. Production config requires the Upstash backend, so attempts cannot
// be multiplied across replicas or forgotten on a cold start.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;

// Lazy per-process index creation — Mango createIndex is idempotent server-side
// but each call still costs a round-trip, so we cache the attempt.
const indexState = { portalUsername: false };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureIndex(db: any, fields: string[], key: keyof typeof indexState): Promise<void> {
  if (indexState[key]) return;
  try {
    await db.createIndex({ index: { fields } });
  } catch {
    // older couchdb / index conflict — find() will fall back to a full scan
    // once. Cache the attempt either way.
  }
  indexState[key] = true;
}

/**
 * POST /api/patient-portal/login
 * Authenticates the patient by username + password (bcrypt), the same shape as
 * staff sign-in. Returns a patient-scoped JWT for subsequent API calls.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipRateKey = `portal-login:ip:${ip}`;
  const ipVerdict = await rateLimit({ key: ipRateKey, limit: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!ipVerdict.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  let body: { username?: string; password?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const username = (body.username || '').trim().toLowerCase();
  const password = body.password || '';

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
  }

  const accountRateKey = `portal-login:account:${username}`;
  const accountVerdict = await rateLimit({ key: accountRateKey, limit: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!accountVerdict.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  try {
    type PatientLike = {
      _id: string;
      firstName?: string;
      surname?: string;
      hospitalNumber?: string;
      portalUsername?: string;
      portalPasswordHash?: string;
      // Real patient docs (and the demo fallback) carry plenty more the
      // portal's Overview/Profile tabs read — pass all of it through rather
      // than hand-picking a subset that quietly drifts from what the UI needs.
      [key: string]: unknown;
    };
    let found: PatientLike | null = null;

    try {
      // Dynamic import to avoid PouchDB SSR crash (same pattern as /api/patients)
      const { patientsDB } = await import('@/lib/db');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = patientsDB() as any;
      await ensureIndex(db, ['type', 'portalUsername'], 'portalUsername');
      const byUser = await db.find({
        selector: { type: 'patient', portalUsername: username },
        limit: 1,
      });
      found = ((byUser.docs || [])[0] as PatientLike) || null;
    } catch (dbErr) {
      // The real database is unreachable (e.g. no CouchDB configured in this
      // environment). In demo mode, answer from the same literal seed data the
      // client-side demo uses instead of failing the whole portal.
      if (!demoFallbackEnabled()) throw dbErr;
      logDemoFallback('login', dbErr);
      found = (await findDemoPatientByUsername(username)) as PatientLike | null;
    }

    // Verify the password. One generic error for "no such user" and "wrong
    // password" so the response never reveals which was wrong.
    const passwordOk = !!found?.portalPasswordHash && await verifyPassword(password, found.portalPasswordHash);
    if (!found || !passwordOk) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }
    // A suspended account keeps its credential on purpose — suspension is
    // usually reversible and re-enrolling from scratch is a poor answer to a
    // temporary problem. This is the check that makes it mean something, and
    // it answers exactly like a wrong password so the response cannot be used
    // to discover whose access was withdrawn.
    const { portalSignInBlocked } = await import('@/modules/identity/services/patient-portal-enrolment');
    if (portalSignInBlocked(found as { portalDisabledAt?: string })) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    // A successful password proof clears both failed-attempt streaks. OTP has
    // its own shared IP/challenge limits, so retaining password failures here
    // would only lock out a legitimate patient who has reached factor two.
    await Promise.all([resetRateLimit(ipRateKey), resetRateLimit(accountRateKey)]);

    // Second factor (KAN-76). When OTP is enabled we stop here and prove
    // possession of the registered phone before issuing any session token —
    // the portal is otherwise protected by a single shared secret, on shared
    // devices, for users who often cannot reset it themselves.
    //
    // Fails CLOSED: if the SMS cannot be delivered no token is issued. A
    // second factor nobody receives is not a factor. The one exception is a
    // patient with no number on file, who would otherwise be permanently
    // locked out of their own records by a config change — they fall through
    // to password-only, and the response says so.
    if (otpEnabled()) {
      const phone = typeof found.phone === 'string' ? found.phone : '';
      const issued = await issueOtp(found._id, phone);

      if (issued.ok) {
        return NextResponse.json({
          otpRequired: true,
          // Identifies the pending challenge on the verify call. Not a
          // session token and carries no privilege — the patient id alone is
          // useless without the code, which only reaches the registered phone.
          challengeId: found._id,
          maskedPhone: issued.maskedPhone,
        });
      }

      if (issued.error !== 'no-phone') {
        return NextResponse.json(
          { error: 'Could not send your verification code. Please try again.' },
          { status: 503 },
        );
      }
      console.warn('[patient-portal/login] OTP enabled but patient has no phone on file — allowing password-only login.');
    }

    // "Is anyone actually using the portal we enrolled them in?" was
    // unanswerable — nothing recorded a portal sign-in. Best-effort, and never
    // in the way of a patient reaching their own records.
    const { recordPortalLogin } = await import('@/modules/identity/services/patient-portal-enrolment');
    await recordPortalLogin(found._id);

    // Issue a patient-scoped JWT (8 hour expiry)
    const token = await createPatientToken({
      sub: found._id,
      name: `${found.firstName} ${found.surname}`,
      hospitalNumber: found.hospitalNumber || '',
      role: 'patient',
    });

    // Minimal identity only — enough to render "logged in as", nothing more.
    //
    // This previously spread the whole patient document (credential fields
    // aside), so authentication returned date of birth, phone, next-of-kin,
    // allergies and chronic conditions. The authentication boundary is the
    // worst place to carry PHI: it is the request most likely to be captured
    // by request logging, proxied, retried, or persisted client-side next to
    // the token.
    //
    // An explicit allow-list, not a spread-and-delete — a spread silently
    // re-leaks every field added to PatientDoc in future.
    //
    // Everything else now comes from GET /api/patient-portal/profile, which
    // requires the token this response issues.
    return NextResponse.json({
      token,
      patient: {
        id: found._id,
        firstName: found.firstName,
        surname: found.surname,
        hospitalNumber: found.hospitalNumber || '',
        registrationHospital: found.registrationHospital,
      },
    });
  } catch (err) {
    logApiError('[patient-portal/login]', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
