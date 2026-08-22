/** @jest-environment node */
/**
 * A settings control either does something, or says it doesn't.
 *
 * `role-settings.ts` declares 92 keys. An audit in Aug 2026 found 56 of them
 * appeared nowhere else in the codebase — not in a hook, not in a service, not
 * in the notification-preference map. Each rendered as a live switch or
 * dropdown a user could set, and each did nothing in either position.
 *
 * That is not cosmetic. The controls make specific claims:
 *
 *   security.twoFactor  "Two-factor authentication — One-time code at sign-in"
 *   lab.secondReview    "Second review for critical values — A colleague
 *                        verifies before release"
 *   cs.discrepancy      "Alert on any discrepancy — Notifies the facility
 *                        admin immediately"
 *   disp.paymentGate    "Block dispensing until payment or exemption"
 *   mar.missedReason    "Require a reason for a missed dose — Recorded in the
 *                        audit log"
 *
 * An administrator who turns those on has been told the platform now verifies
 * critical results, counts narcotics, and demands a second factor. It does
 * none of it. `reg.duplicates` was the same shape and was worse still: the
 * registration form actually READ the flag into a variable and then never used
 * it, so the one setting that looked wired was not.
 *
 * The rule this pins: every declared key is either read somewhere in `src`, or
 * carries `pending: true` — which makes the UI render "Not available yet"
 * instead of a working control. Wiring a setting up means deleting its marker.
 * Adding a new decorative one fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { specForRole } from '@/lib/role-settings';
import type { RoleSettingRow, RoleSettingsSpec } from '@/lib/role-settings';
import { ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

const SRC = path.join(process.cwd(), 'src');
const SPEC = path.join(SRC, 'lib/role-settings.ts');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sources(full, out);
    } else if (/\.tsx?$/.test(entry) && full !== SPEC) {
      out.push(full);
    }
  }
  return out;
}

/** Every string literal in the app, outside the declaration file and tests. */
const APP_SOURCE = sources(SRC).map(f => readFileSync(f, 'utf8')).join('\n');

interface Declared { key: string; label: string; pending: boolean }

/**
 * Every settings page a signed-in user can reach. There is no map of specs to
 * iterate — `specForRole` is a switch — so this walks the role table, which is
 * the same source the Edge proxy routes on. A role added there without a
 * settings spec falls through to a default, which this still covers.
 */
const SPECS: RoleSettingsSpec[] = (Object.keys(ROLE_ROUTE_TABLE) as UserRole[])
  .map(role => specForRole(role));

const declared: Declared[] = [];
const seen = new Set<string>();
for (const spec of SPECS) {
  for (const section of spec.sections) {
    for (const row of section.rows as RoleSettingRow[]) {
      if (row.kind !== 'toggle' && row.kind !== 'select') continue;
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      declared.push({ key: row.key, label: row.label, pending: row.pending === true });
    }
  }
}

/** Read anywhere — a `useRoleFlag('x')` call, or a map like notification-preferences. */
const isRead = (key: string) =>
  APP_SOURCE.includes(`'${key}'`) || APP_SOURCE.includes(`"${key}"`);

describe('no control lies about what it does', () => {
  it('finds every declared setting either read or marked pending', () => {
    const lying = declared
      .filter(d => !d.pending && !isRead(d.key))
      .map(d => `${d.key} — "${d.label}" renders a live control and nothing reads it`);
    // Fix by wiring the key up, or by passing `true` as the last argument to
    // `tg(...)` / `sel(...)` so the UI shows "Not available yet".
    expect(lying).toEqual([]);
  });

  it('keeps the scan honest — a real fraction of keys are genuinely wired', () => {
    // If `isRead` broke, everything would look unwired and the assertion above
    // would fail loudly. If APP_SOURCE were empty the same thing happens. This
    // catches the opposite break: a match that is too loose to mean anything.
    const wired = declared.filter(d => isRead(d.key));
    expect(wired.length).toBeGreaterThan(20);
    expect(wired.length).toBeLessThan(declared.length);
  });
});

describe('the pending marker stays a statement about this codebase', () => {
  it('carries no marker on a setting that is actually read', () => {
    // A stale `pending` is the mirror-image lie: the control says "Not
    // available yet" while the app is honouring the stored value.
    const stale = declared
      .filter(d => d.pending && isRead(d.key))
      .map(d => `${d.key} is marked pending but is read — drop the marker`);
    expect(stale).toEqual([]);
  });

  it('declares no key twice', () => {
    // The same key under two roles is fine and common; the same key twice in
    // one role's page is a control that fights itself.
    for (const spec of SPECS) {
      const keys = spec.sections
        .flatMap(s => s.rows as RoleSettingRow[])
        .filter(r => r.kind === 'toggle' || r.kind === 'select' || r.kind === 'text')
        .map(r => (r as { key: string }).key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('the safety and security claims specifically', () => {
  // These are named rather than left to the general rule because each one, if
  // it silently became a live-but-unwired control again, tells a clinician or
  // an administrator that a check is running when it is not.
  const CLAIMS = [
    'security.twoFactor', 'lab.secondReview', 'lab.autoFlag', 'lab.notifyClinician',
    'mar.barcode', 'mar.missedReason', 'cs.discrepancy', 'cs.reconcile',
    'vitals.rangeWarn', 'disp.paymentGate', 'stock.adjustReason',
  ];

  it.each(CLAIMS)('%s is not presented as an active control', key => {
    const row = declared.find(d => d.key === key);
    // Three acceptable outcomes, in increasing order of goodness:
    //   - the key is gone entirely, because the fake control was replaced by a
    //     real one. `security.twoFactor` took this route: the toggle became
    //     `{ kind: 'action', action: 'mfa' }`, a "Set up" button that opens
    //     `MfaEnrolment`, so there is no stored flag left to lie about.
    //   - it is marked `pending` and renders "Not available yet".
    //   - it is read somewhere, i.e. actually wired.
    // What is forbidden is the fourth: a live switch nothing consults.
    if (!row) return;
    expect(row.pending || isRead(key)).toBe(true);
  });

  it('still covers a real set of claims, so the exemption above cannot empty it', () => {
    // `if (!row) return` would silently pass a list of keys that had all been
    // renamed. At least most of them must still be declared somewhere.
    const present = CLAIMS.filter(key => declared.some(d => d.key === key));
    expect(present.length).toBeGreaterThanOrEqual(CLAIMS.length - 2);
  });
});
