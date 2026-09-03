/**
 * @jest-environment node
 *
 * Turning a login back on must not be routed through the generic update.
 *
 * The bug: both admin surfaces deactivated with `deactivateUser` but activated
 * with `updateUser({ isActive: true })`. That lands on the API's `update`
 * action, which re-validates the account's organization and hospital before
 * saving — so re-activating someone whose organization had since been
 * deactivated failed with "Assigned organization was not found or is inactive",
 * a check with nothing to do with restoring access. Deactivation never had the
 * problem, which is why it went unnoticed: the pair was asymmetric.
 *
 * Pinned at the source because the defect is a wrong function call, not a wrong
 * value — `reactivateUser` has always been correct, nothing was calling it.
 */

import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

/**
 * Source with comments stripped.
 *
 * The rule is about what the code CALLS. Without this the assertion trips over
 * the comments explaining the very bug it guards — which is how a guard ends up
 * being loosened until it no longer guards anything.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// `/settings/manage` was a third account-administration surface until
// 2026-08-21, when its User Management tab was removed — accounts live on
// /admin/users and /org-admin/users, which are the two listed here.
const SURFACES = ['app/(dashboard)/admin/users/[id]/page.tsx'];

describe('activation uses its own action', () => {
  test.each(SURFACES)('%s does not flip isActive through updateUser', file => {
    // `updateUser(id, { isActive: true })` in any spacing.
    expect(code(file)).not.toMatch(/updateUser\([^)]*\{\s*isActive:\s*true/);
  });

  test.each(SURFACES)('%s reactivates through the dedicated call', file => {
    // The page uses the browser-safe API client. The boolean only selects the
    // dedicated activate/deactivate action; it never falls through `update`.
    expect(code(file)).toMatch(/\bsetClientUserActive\(/);
    expect(code(file)).toMatch(/\bsetActive\(true\)/);
  });

  test('the API keeps activation free of the organization check', () => {
    // The guard belongs on `update`, which changes org/hospital assignment —
    // not on a flag flip. If `reactivate` ever grows one, this fails.
    const route = read('modules/identity/api/users-route.ts');
    const start = route.indexOf("if (action === 'deactivate' || action === 'reactivate')");
    expect(start).toBeGreaterThan(-1);
    const handler = route.slice(start, route.indexOf("if (action === 'delete')", start));
    expect(handler).not.toContain('validateActiveOrganization');
  });

  test('the users hook exposes reactivate alongside deactivate', () => {
    // Both halves of the pair available from one place, so the next caller has
    // no reason to reach for `update` again.
    const hook = read('lib/hooks/useUsers.ts');
    expect(hook).toMatch(/const reactivate = useCallback/);
    expect(hook).toMatch(/deactivate,\s*reactivate/);
  });
});
