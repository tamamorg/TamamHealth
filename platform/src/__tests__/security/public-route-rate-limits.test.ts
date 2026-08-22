/** @jest-environment node */
/**
 * Every route reachable without a staff session carries a rate limit.
 *
 * `proxy.ts` skips the staff CSRF check on `/api/booking/*` and says why:
 * "these routes carry their own rate limits and the required slot hold." That
 * sentence is the reason it is safe to skip CSRF there, so it has to stay true
 * — and a sentence in a comment cannot enforce itself. This suite is what
 * makes it enforceable.
 *
 * The booking routes were already limited (`guardPublicRate`); the patient
 * portal behind the token was not, which is what this file was written for.
 * Reading the source rather than exercising each handler is deliberate: the
 * question is "does this route call a limiter at all", and a new unlimited
 * route should fail here on the day it is added, before anyone writes a
 * handler test for it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const API = path.join(process.cwd(), 'src/app/api');

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(API, f).replace(/\/route\.ts$/, '');

/** Any of the three limiter helpers in use. */
const LIMITED = /checkRateLimit\(|guardPublicRate\(|guardPortalWrite\(|rateLimit\(\{/;

/**
 * Routes reachable without a staff session: public booking, the patient portal,
 * the pay-by-link checkout.
 *
 * Payment-gateway webhooks are deliberately excluded — they authenticate by
 * provider signature and are called at a rate the provider decides, so a limit
 * would drop real callbacks rather than protect anything.
 */
const PUBLIC_PREFIXES = ['booking', 'patient-portal', 'checkout'];

const publicRoutes = routeFiles(API).filter(f =>
  PUBLIC_PREFIXES.some(p => rel(f) === p || rel(f).startsWith(`${p}/`)),
);

describe('public routes are rate limited', () => {
  it('finds the public surface', () => {
    // A rename that empties this list would make every assertion below vacuous.
    expect(publicRoutes.length).toBeGreaterThanOrEqual(12);
  });

  it.each(publicRoutes.map(f => [rel(f), f]))('%s calls a limiter', (_name, file) => {
    const src = readFileSync(file as string, 'utf8');
    // The portal's floor lives inside `verifyPatientToken`, which every portal
    // route calls — that counts, and is why a new portal route is safe by
    // default rather than by remembering.
    const inherits = src.includes('verifyPatientToken');
    expect(LIMITED.test(src) || inherits).toBe(true);
  });
});

describe('the portal floor is inherited, not repeated', () => {
  it('lives in verifyPatientToken so a new route cannot forget it', () => {
    const auth = readFileSync(path.join(process.cwd(), 'src/lib/patient-portal-auth.ts'), 'utf8');
    expect(auth).toMatch(/guardPortalFloor/);
    // Keyed on the patient: a stolen token can change IP freely.
    expect(auth).toMatch(/portal:floor:\$\{patientId\}/);
  });

  it('caps the three portal endpoints that write', () => {
    for (const route of ['messages', 'appointments', 'payments']) {
      const src = readFileSync(
        path.join(API, 'patient-portal', route, 'route.ts'), 'utf8',
      );
      expect(src).toMatch(/guardPortalWrite\(/);
    }
  });
});

describe('the booking routes back the proxy’s CSRF exemption', () => {
  it('every booking route guards its own rate', () => {
    // proxy.ts skips CSRF here on exactly this basis.
    for (const file of routeFiles(path.join(API, 'booking'))) {
      expect(readFileSync(file, 'utf8')).toMatch(/guardPublicRate\(/);
    }
  });

  it('holds are tighter than reads — a hold consumes a real slot', () => {
    const hold = readFileSync(path.join(API, 'booking/hold/route.ts'), 'utf8');
    const slots = readFileSync(path.join(API, 'booking/slots/route.ts'), 'utf8');
    const limitOf = (src: string) => Number(/guardPublicRate\([^,]+,\s*'[a-z-]+',\s*(\d+)/.exec(src)?.[1]);
    expect(limitOf(hold)).toBeLessThan(limitOf(slots));
  });
});
