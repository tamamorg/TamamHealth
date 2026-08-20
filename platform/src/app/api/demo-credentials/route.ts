/**
 * API: /api/demo-credentials
 * GET — the seeded demo roster with the password for each account, which the
 * one-tap account picker on `/login` signs in with.
 *
 * Answers ONLY on a standalone demo deployment: `NEXT_PUBLIC_DEMO_MODE`
 * exactly 'true' AND no CouchDB users database configured (see
 * `isStandaloneDemo`). Everywhere else it returns an empty roster.
 *
 * Both halves of that gate matter, and this route is why the second one
 * exists. It is unauthenticated by necessity — the caller is on the sign-in
 * page and has no session — so a single mis-set environment variable used to
 * be all that stood between an anonymous request and three dozen working
 * credentials. A deployment that has a users database now discloses nothing
 * here no matter what the flag says, and on the demo the accounts it hands
 * out reach seeded fiction only: no CouchDB, no real patients.
 *
 * The plaintexts are derived server-side from `SEED_CREDENTIALS_SECRET` and
 * are never baked into the JS bundle.
 */

import { NextResponse } from 'next/server';

// `getOrCreateSeedCredentials` reads `node:fs` when no secret is configured,
// which the Edge runtime cannot do.
export const runtime = 'nodejs';
// Per-deploy state, not static: never cache, and never let a CDN hold it.
export const dynamic = 'force-dynamic';

interface DemoProfileResponse {
  username: string;
  password: string;
  name: string;
  role: string;
  /** Facility the account works at, for grouping the picker. */
  facility?: string;
  orgId?: string;
}

export async function GET() {
  try {
    const { isStandaloneDemo } = await import('@/lib/server-users');
    if (!isStandaloneDemo()) {
      return NextResponse.json({ profiles: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const { getOrCreateSeedCredentials, DEMO_USER_PROFILES } = await import('@/lib/seed-credentials');
    const credentials = await getOrCreateSeedCredentials();

    // An account with no generated password is dropped rather than listed
    // with a null: a card that cannot sign in is worse than no card.
    const profiles: DemoProfileResponse[] = DEMO_USER_PROFILES.flatMap((p) => {
      const password = credentials.passwords[p.username];
      if (!password) return [];
      return [{
        username: p.username,
        password,
        name: p.name,
        role: p.role,
        facility: p.hospitalName,
        orgId: p.orgId,
      }];
    });

    return NextResponse.json({ profiles }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[API /demo-credentials GET]', err);
    return NextResponse.json({ error: 'Failed to read seed credentials' }, { status: 500 });
  }
}
