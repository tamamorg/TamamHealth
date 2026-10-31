/**
 * The clinical dashboard's greeting-row actions.
 *
 * The row once added the role's menu shortcuts (`getPageHeaderNavItems`) after
 * Dispense and Print, more than its track could hold, so the overflow went
 * behind a "More" menu. The shortcuts only repeated the menu, and More was
 * taken out (2026-10-30): the row now carries the dashboard's own actions
 * alone — Dispense, Print and the station's extras — every one written out.
 */
import fs from 'node:fs';
import path from 'node:path';

const source = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

const dashboard = source('components/ehr/EhrClinicalDashboard.tsx');

describe('the greeting row shows the dashboard\'s own actions, no More', () => {
  test('there is no More menu and no menu shortcuts in the row', () => {
    expect(dashboard).not.toContain('ehr-header-more');
    expect(dashboard).not.toContain('getPageHeaderNavItems');
    expect(dashboard).not.toContain('INLINE_HEADER_ACTIONS');
  });

  test('every action is written out', () => {
    expect(dashboard).toContain('{headerActions.map(action => {');
    expect(dashboard).toContain('...(extraHeaderActions ?? [])');
  });

  test('tablet centre lists fit all five columns with Status still visible', () => {
    const tabletCss = source('app/tablet-desktop.css');
    expect(tabletCss).toMatch(/\.appointment-card-flow \.appointment-card-row\.ehr-appointment-row\s*\{[\s\S]*?min-width:\s*0\s*!important;/);
    expect(tabletCss).toMatch(/\.appointment-card-flow \.appointment-card-head,[\s\S]*?minmax\(72px, 0\.9fr\)\s*!important;/);
    expect(tabletCss).toContain('.ehr-care-list .ehr-queue-scroll { overflow-x: hidden !important; }');
    expect(tabletCss).toMatch(/\.tamam-ehr-app \.ehr-worklist-head,[\s\S]*?min-width:\s*0\s*!important;/);
    expect(tabletCss).toMatch(/\.ehr-center-panel \.ehr-worklist-status,[\s\S]*?max-width:\s*100%;/);
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
