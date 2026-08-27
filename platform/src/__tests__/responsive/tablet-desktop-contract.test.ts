import fs from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(process.cwd(), 'src/app');
const layoutSource = fs.readFileSync(path.join(appDir, 'layout.tsx'), 'utf8');
const tabletCss = fs.readFileSync(path.join(appDir, 'tablet-desktop.css'), 'utf8');

describe('tablet compact-desktop contract', () => {
  it('loads after the legacy global cascade', () => {
    expect(layoutSource.indexOf('import "./tablet-desktop.css";'))
      .toBeGreaterThan(layoutSource.indexOf('import "./globals.css";'));
  });

  it('is isolated from the phone and full desktop layouts', () => {
    expect(tabletCss).toContain('@media (min-width: 640px) and (max-width: 1279px)');
    expect(tabletCss).toContain('--app-top-rail-height: 60px');
    expect(tabletCss).toContain('html { font-size: 13px; }');
  });

  it('hands over to the desktop cascade at exactly one boundary', () => {
    // The compact-desktop range and the "desktop starts here" rules in
    // globals.css are two halves of one boundary. They were 1180/1181 — which
    // agreed, but excluded a landscape iPad Pro 11" (1194 CSS px), so every
    // iPad held sideways got the desktop cascade at a width it does not fit.
    // Raising only the tablet half made the two OVERLAP, and both applied:
    // the appointments header rendered three rows deep with the page title
    // pushed into the corner. Whatever the number is, it has to be one number.
    const globalsCss = fs.readFileSync(path.join(appDir, 'globals.css'), 'utf8');
    expect(globalsCss).not.toContain('min-width: 1181px');
    expect(globalsCss).toContain('@media (min-width: 1280px)');
  });

  it.each([
    '.ehr-left-rail',
    '.ehr-right-rail',
    '.cn-sidebar',
    '.rpt-rail',
    '.labord-rail',
    '.ehr-set-grid',
    '.fs-shell',
    '.sadb-shell',
    '.pp-body',
    '.bl-pay-layout',
    '.gov-grid',
    '.gov-map-body',
    '.mgmt-main-bar',
  ])('keeps the desktop module structure for %s', selector => {
    expect(tabletCss).toContain(selector);
  });

  it('keeps dense clinical data scrollable instead of hiding columns', () => {
    expect(tabletCss).toContain('.ehr-worklist-head > span:nth-child(n + 6)');
    expect(tabletCss).toContain('overflow: auto !important');
    expect(tabletCss).toContain('.appointment-card-head { display: grid !important');
  });

  it('compacts queue tabs and lets the dashboard search consume its track', () => {
    expect(tabletCss).toContain('.ehr-daybar .ehr-day-tabs button:not(.ehr-mobile-day-check)');
    expect(tabletCss).toContain('padding-inline: clamp(7px, 0.9vw, 10px)');
    expect(tabletCss).toContain('.ehr-center-panel .ehr-daybar > .ehr-queue-search');
    expect(tabletCss).toContain('max-width: none');
  });

  it('keeps portalled popup surfaces aligned to their viewport-bounded dialog', () => {
    expect(tabletCss).toContain('.modal-portal-dialog > *');
    expect(tabletCss).toContain('margin-inline: auto !important');
    expect(tabletCss).toContain('max-height: 100%');
  });

  it('reserves the flexible list-toolbar track for search', () => {
    expect(tabletCss).toContain('.ehr-list-header-toolbar');
    expect(tabletCss).toContain('grid-template-columns: minmax(220px, 1fr) max-content');
    expect(tabletCss).toContain('.ehr-list-header-search > *');
  });

  it('shows one search affordance when the full tablet search field is present', () => {
    expect(tabletCss).toContain('.ehr-top-actions .ehr-mobile-search-trigger { display: none !important; }');
  });
});
