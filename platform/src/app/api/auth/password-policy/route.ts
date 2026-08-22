/**
 * API: GET /api/auth/password-policy
 *
 * What this deployment requires of a password, so the screens where someone
 * CHOOSES one can say the same thing the server will enforce.
 *
 * Public, and deliberately so: two of the three places a password is chosen —
 * the invitation page and the reset page — have no session by definition, and
 * a minimum length is not a secret. Knowing that passwords here must be twelve
 * characters helps an attacker nothing and helps a nurse on a ward tablet
 * quite a lot, because the alternative is typing a password, submitting it,
 * and being told afterwards.
 *
 * The rules themselves are not returned. The blocklist is long, most of it is
 * only meaningful in combination with the account's own name, and shipping it
 * would be handing over a checklist of what not to try.
 */
import { NextResponse } from 'next/server';
import { logApiError } from '@/lib/api-auth';
import { DEFAULT_MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/lib/password-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { getMinPasswordLength } = await import('@/lib/password-policy-server');
    return NextResponse.json({
      minLength: await getMinPasswordLength(),
      maxLength: MAX_PASSWORD_LENGTH,
    });
  } catch (err) {
    logApiError('GET /api/auth/password-policy', err);
    // A client that cannot read the policy still has to render a form. The
    // documented default is the honest fallback: the server remains the
    // authority, and a stricter real policy corrects the hint on submit.
    return NextResponse.json({
      minLength: DEFAULT_MIN_PASSWORD_LENGTH,
      maxLength: MAX_PASSWORD_LENGTH,
    });
  }
}
