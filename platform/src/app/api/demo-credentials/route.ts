/**
 * API: /api/demo-credentials
 * GET — surfaces the seeded usernames + freshly-generated plaintext passwords.
 *
 * Two callers depend on this route:
 *
 *   1. The browser-side PouchDB seed (`lib/db-seed.ts`). It needs the same
 *      plaintexts the server's login API will check, so the local PouchDB
 *      hash matches.
 *   2. The "Demo Accounts" dropdown on `/login` — autofills credentials so
 *      anyone exploring the demo can sign in without sharing static creds.
 *
 * The plaintexts themselves live ONLY in `.seed-credentials.json` on the
 * server (mode 0600, gitignored). They are never bundled into the JS payload.
 *
 * Production gating
 * ─────────────────
 * When `NEXT_PUBLIC_DEMO_MODE === 'false'` (real deploy) this route returns
 * an EMPTY profile list — no passwords at all. Because the route is
 * unauthenticated and CSRF-exempt (below), disclosing even the bootstrap
 * `admin` password here would hand any anonymous caller a working
 * super-admin credential. The operator instead reads the bootstrap password
 * from `.seed-credentials.json` (mode 0600) or the deploy console.
 *
 * The route is intentionally exempt from CSRF + auth in `proxy.ts` so
 * the unauthenticated browser seed can fetch it on first boot (demo only).
 */

import { NextResponse } from 'next/server';

// Force the Node runtime — `getOrCreateSeedCredentials` uses `node:fs` to
// read/write the on-disk credentials file, which the Edge runtime cannot do.
export const runtime = 'nodejs';
// No caching: the file may be regenerated between requests (e.g. operator
// added a new role), and the answer is per-deploy state, not static.
export const dynamic = 'force-dynamic';

interface ProfileResponse {
  username: string;
  password: string | null;
}

export async function GET() {
  try {
    const { getOrCreateSeedCredentials, DEMO_USER_PROFILES } = await import(
      '@/lib/seed-credentials'
    );
    const credentials = await getOrCreateSeedCredentials();
    // Fail CLOSED: only an EXPLICIT demo (NEXT_PUBLIC_DEMO_MODE==='true')
    // discloses passwords. An unset/typo'd value must not fall open — this
    // route is unauthenticated and CSRF-exempt, so returning any password
    // here hands anyone on the internet a working credential → PHI breach.
    // (Matches config-validation, which also treats only ==='true' as demo.)
    const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
    if (!isDemo) {
      return NextResponse.json({ profiles: [] });
    }

    // Demo mode: full roster. Each entry is { username, password|null };
    // null entries mean a profile exists in the roster but no password has
    // been generated yet (shouldn't happen in steady state, but the seed
    // path tolerates it).
    const profiles: ProfileResponse[] = DEMO_USER_PROFILES.map((p) => ({
      username: p.username,
      password: credentials.passwords[p.username] ?? null,
    }));
    return NextResponse.json({ profiles });
  } catch (err) {
    console.error('[API /demo-credentials GET]', err);
    return NextResponse.json(
      { error: 'Failed to read seed credentials' },
      { status: 500 },
    );
  }
}
