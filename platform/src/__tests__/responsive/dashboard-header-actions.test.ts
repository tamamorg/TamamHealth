/**
 * The clinical dashboard's greeting-row actions fit the column they sit in.
 *
 * That row is a FIXED track in the header grid (~195px at every width — the
 * same width on a 1194px tablet as on a 1440px desktop), while its contents
 * are role-derived: Dispense and Print plus however many shortcuts the signed
 * in role's nav yields through `getPageHeaderNavItems`. A doctor therefore had
 * more labelled buttons than the track can hold, and because the row is
 * `nowrap` — which is what keeps it on the greeting's line rather than
 * wrapping under it — they compressed into each other instead of moving.
 *
 * Two are written out; the rest open from a "More" menu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPageHeaderNavItems } from '@/components/ehr/ehr-navigation';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';

const source = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

const dashboard = source('components/ehr/EhrClinicalDashboard.tsx');

/** What the header would build for `role`: Dispense + Print + the shortcuts. */
function headerActionCount(role: UserRole): number {
  const config = ROLE_PERMISSIONS[role];
  const shortcuts = getPageHeaderNavItems(
    config.navItems || [],
    role,
    config.defaultDashboard || '/dashboard',
  );
  return 2 + shortcuts.length; // Dispense and Print are always candidates.
}

describe('the greeting row shows two actions and hides the rest', () => {
  test('the row slices at a stated limit rather than rendering every action', () => {
    expect(dashboard).toContain('const INLINE_HEADER_ACTIONS = 2;');
    expect(dashboard).toContain('headerActions.slice(0, INLINE_HEADER_ACTIONS)');
    expect(dashboard).toContain('headerActions.length > INLINE_HEADER_ACTIONS');
    expect(dashboard).toContain('headerActions.slice(INLINE_HEADER_ACTIONS)');
  });

  test('a clinical role really does overflow, so More is not dead code', () => {
    // If no role ever produced a third action the menu would never render and
    // this whole mechanism would be theatre.
    const overflowing = (['doctor', 'clinical_officer', 'nurse'] as UserRole[])
      .filter(role => headerActionCount(role) > 2);
    expect(overflowing.length).toBeGreaterThan(0);
  });

  test('the More menu closes on outside click and on Escape', () => {
    // A menu anchored in a header that scrolls away is a trap without both.
    expect(dashboard).toContain("document.addEventListener('mousedown', onDown)");
    expect(dashboard).toContain("event.key === 'Escape'");
  });

  test('the More menu escapes the clipped tablet schedule shell', () => {
    const globalsCss = source('app/globals.css');
    const tabletCss = source('app/tablet-desktop.css');
    expect(dashboard).toContain("import { createPortal } from 'react-dom';");
    expect(dashboard).toContain('moreRef.current?.getBoundingClientRect()');
    expect(dashboard).toContain('headerMoreMenuRef.current?.contains(target)');
    expect(dashboard).toContain('document.body');
    expect(globalsCss).toMatch(/\.ehr-header-more-menu\s*\{[\s\S]*?position:\s*fixed;/);
    expect(globalsCss).toMatch(/\.ehr-header-more-menu\s*\{[\s\S]*?z-index:\s*1500;/);
    expect(tabletCss).toMatch(/\.ehr-header-more-menu button\s*\{[\s\S]*?font-size:\s*12px;/);
    expect(tabletCss).toMatch(/\.ehr-header-more-menu button svg[\s\S]*?width:\s*15px;/);
  });

  test('the menu announces itself as a menu', () => {
    expect(dashboard).toContain('aria-haspopup="menu"');
    expect(dashboard).toContain('role="menuitem"');
  });
});

describe('the primary button shortens without changing its name', () => {
  test('both labels are rendered, and only the painted one changes', () => {
    // Swapping the accessible name with the viewport would mean the same
    // control answered to two different names depending on the device.
    expect(dashboard).toContain('aria-label="Book appointment"');
    expect(dashboard).toContain('<span className="ehr-label-full">Book appointment</span>');
    expect(dashboard).toContain('<span className="ehr-label-compact">Appointment</span>');
  });

  test('the compact label is hidden by default and shown only on tablet', () => {
    const globalsCss = source('app/globals.css');
    const tabletCss = source('app/tablet-desktop.css');
    expect(globalsCss).toContain('.ehr-label-compact { display: none; }');
    expect(tabletCss).toContain('.ehr-label-full { display: none !important; }');
    expect(tabletCss).toContain('.ehr-label-compact { display: inline !important; }');
  });
});
