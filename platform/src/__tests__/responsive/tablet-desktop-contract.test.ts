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
    expect(tabletCss).toContain('@media (min-width: 640px) and (max-width: 1180px)');
    expect(tabletCss).toContain('--app-top-rail-height: 60px');
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
  ])('keeps the desktop module structure for %s', selector => {
    expect(tabletCss).toContain(selector);
  });

  it('keeps dense clinical data scrollable instead of hiding columns', () => {
    expect(tabletCss).toContain('.ehr-worklist-head > span:nth-child(n + 6)');
    expect(tabletCss).toContain('overflow: auto !important');
    expect(tabletCss).toContain('.appointment-card-head { display: grid !important');
  });
});
