/** @jest-environment node */
/**
 * A role list that already exists must not be retyped.
 *
 * `write-permissions.ts` names eight canonical groups and compiles them into
 * the CouchDB validator. The API routes guard the same rules — and 51 of the 93
 * declared their own `const READ_ROLES: UserRole[] = [...]` beside them, 16 of
 * which were byte-identical to another file's. They had no choice: none of the
 * groups were exported.
 *
 * That is not an aesthetic complaint. It is the mechanism behind the eight
 * workflow bugs found in Aug 2026 — a role passed the route guard, was refused
 * by the validator, and the write died at replication with nothing in the UI to
 * say so. Two hand-maintained copies of one rule drift; the only durable fix is
 * for there to be one copy.
 *
 * This does NOT demand that every route use a canonical group. Plenty of routes
 * legitimately want a set that matches no group — a lab route granting
 * `lab_tech` and `radiologist` is its own thing. What it forbids is retyping a
 * set that already has a name.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ADMIN, CLINICIANS, NURSING_AND_CLINICIANS, REGISTRATION,
  BILLING, ALL_STAFF, EVERY_ROLE, VITAL_EVENTS,
} from '@/lib/sync/write-permissions';

const API = path.join(process.cwd(), 'src/app/api');

const GROUPS: Record<string, readonly string[]> = {
  ADMIN, CLINICIANS, NURSING_AND_CLINICIANS, REGISTRATION,
  BILLING, ALL_STAFF, EVERY_ROLE, VITAL_EVENTS,
};

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** Every `const NAME: UserRole[] = ['a', 'b']` literal in a route. */
function literalRoleLists(source: string): { name: string; roles: Set<string> }[] {
  const found: { name: string; roles: Set<string> }[] = [];
  for (const [, name, body] of source.matchAll(/const (\w+): UserRole\[\] = \[([^\]]*)\];/g)) {
    const roles = new Set([...body.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
    if (roles.size) found.push({ name, roles });
  }
  return found;
}

const sameSet = (a: Set<string>, b: readonly string[]) =>
  a.size === new Set(b).size && [...a].every(r => b.includes(r));

describe('routes reuse the canonical groups instead of retyping them', () => {
  const offenders: string[] = [];
  for (const file of routeFiles(API)) {
    for (const { name, roles } of literalRoleLists(readFileSync(file, 'utf8'))) {
      for (const [groupName, members] of Object.entries(GROUPS)) {
        if (sameSet(roles, members)) {
          offenders.push(`${path.relative(API, file)} — ${name} is exactly ${groupName}`);
        }
      }
    }
  }

  it('finds no route re-declaring a named group', () => {
    // Fix: `import { CLINICIANS } from '@/lib/sync/write-permissions'` and
    // `const CREATE_ROLES = CLINICIANS`. A route that imports the group cannot
    // drift from the validator that compiles it.
    expect(offenders).toEqual([]);
  });
});

describe('the groups are usable from a route at all', () => {
  it('exports all eight', () => {
    for (const [name, members] of Object.entries(GROUPS)) {
      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBeGreaterThan(0);
      expect(name).toBeTruthy();
    }
  });

  it('accepts a readonly array at the guard boundary', async () => {
    // `hasRole` took a mutable `UserRole[]`, which by itself made a canonical
    // group unusable in a route and forced the copy. Assert the widening holds.
    const { hasRole } = await import('@/lib/api-auth');
    const frozen: readonly ('doctor')[] = Object.freeze(['doctor'] as const);
    expect(hasRole({ sub: 'u', username: 'u', role: 'doctor', name: 'U' }, frozen)).toBe(true);
  });

  it('keeps at least the routes already migrated importing them', () => {
    // A regression here means somebody inlined a group back into a route.
    const migrated = [
      'users/route.ts', 'prescriptions/route.ts', 'medical-records/route.ts',
      'medical-records/[id]/route.ts', 'organizations/route.ts',
      'account-requests/route.ts', 'account-requests/[id]/route.ts',
      'usage/events/route.ts', 'usage/summary/route.ts',
    ];
    for (const rel of migrated) {
      const src = readFileSync(path.join(API, rel), 'utf8');
      expect(src).toContain("from '@/lib/sync/write-permissions'");
    }
  });
});
