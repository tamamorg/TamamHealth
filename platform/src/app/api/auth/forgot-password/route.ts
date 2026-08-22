/**
 * API: POST /api/auth/forgot-password
 *
 * The missing half of the invitation flow. `issueUserInvite` had exactly one
 * call site — account creation — so a staff member who forgot their password
 * had no self-service route at all: the login page offered no link (the
 * `login.forgotPassword` string existed in both locales and was rendered
 * nowhere), and the only path forward was an administrator reset that puts a
 * plaintext credential back into the room and over a phone line.
 *
 * Setting a password you have never had and replacing one you have forgotten
 * are the same operation on the same document, so this reuses the invitation
 * machinery entirely: same token construction, same 72-hour expiry, same
 * single-use redemption at /api/auth/accept-invite. Only the email copy
 * differs.
 *
 * Three rules, all of them the reason this endpoint is safe to expose:
 *
 *   1. ONE ANSWER FOR EVERY OUTCOME. Unknown username, no email on file,
 *      deactivated account, mail gateway down — all identical, or the endpoint
 *      becomes an oracle for which usernames exist and which staff have email.
 *   2. RATE LIMITED BY USERNAME AND BY IP. Not because the token is guessable
 *      (it is 256 bits) but because each call scans the roster and sends mail,
 *      and neither should be free.
 *   3. IT ISSUES NOTHING. No session, no password, no confirmation that
 *      anything was sent. It puts a link in a mailbox, and the mailbox is the
 *      proof.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logApiError, serverError } from '@/lib/api-auth';
import { getClientIp } from '@/lib/request-utils';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const WINDOW_MS = 60 * 60 * 1000;
const PER_USERNAME_LIMIT = 5;
const PER_IP_LIMIT = 20;

/** Rule 1. Said in a way that is true whatever actually happened. */
const ACCEPTED = {
  ok: true,
  message: 'If that account exists and has an email address on file, a link to set a new '
    + 'password is on its way. It expires in 72 hours. If nothing arrives, ask your administrator.',
};

export async function POST(request: NextRequest) {
  try {
    let body: { username?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const username = (body.username || '').trim().toLowerCase();
    // An empty or malformed username is answered the same way as a real one.
    // Saying "that is not a valid username" would confirm, by contrast, that
    // a well-formed one which got the generic answer might exist.
    if (!username || !/^[a-z0-9._@+-]+$/.test(username)) {
      return NextResponse.json(ACCEPTED, { status: 202 });
    }

    const [ipVerdict, userVerdict] = await Promise.all([
      rateLimit({ key: `forgot:ip:${getClientIp(request)}`, limit: PER_IP_LIMIT, windowMs: WINDOW_MS }),
      rateLimit({ key: `forgot:user:${username}`, limit: PER_USERNAME_LIMIT, windowMs: WINDOW_MS }),
    ]);
    if (!ipVerdict.allowed || !userVerdict.allowed) {
      // Even the throttle answers the same way, so its timing cannot be used
      // to tell a real username from a made-up one.
      return NextResponse.json(ACCEPTED, { status: 202 });
    }

    try {
      const { getAllUsers } = await import('@/lib/services/user-service');
      const users = await getAllUsers();
      // Matched on username OR email, because the person who has forgotten
      // their password has often also forgotten which of the two they used.
      const match = users.find(user =>
        user.isActive !== false
        && (user.username === username || user.email?.trim().toLowerCase() === username));

      if (match) {
        const { deliverAccountInvite } = await import('@/lib/services/invite-delivery');
        // Outcome deliberately discarded: reporting it would break rule 1.
        // `deliverAccountInvite` never throws, and logs its own failures.
        await deliverAccountInvite(match, 'reset');
        const { logAudit } = await import('@/lib/services/audit-service');
        await logAudit('password_reset_requested', match._id, match.username,
          `A password reset link was requested for "${match.username}"`, true);
      }
    } catch (err) {
      // Even an internal failure answers 202. An operator finds it in the log;
      // a stranger learns nothing from the response either way.
      logApiError('POST /api/auth/forgot-password', err);
    }

    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (err) {
    logApiError('POST /api/auth/forgot-password', err);
    return serverError();
  }
}
