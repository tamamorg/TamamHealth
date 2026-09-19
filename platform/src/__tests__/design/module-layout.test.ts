/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { moduleIdentity } from '@/components/ehr/module-identity';

test('every existing dashboard module has an intentional visual identity', () => {
  const routes = fs.readdirSync(path.join(process.cwd(), 'src/app/(dashboard)'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => `/${entry.name}`);
  for (const route of routes) {
    // Death records deliberately use the neutral document glyph.
    if (route === '/deaths') continue;
    expect(moduleIdentity(route).icon).not.toBe('record');
  }
});

test('tablet compact-button sizing cannot shrink nested module menu rows', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/app/tablet-desktop.css'), 'utf8');
  expect(css).not.toMatch(/\.ehr-top-modules\s+button\s*,/);
  expect(css).toContain('.ehr-top-modules > button,');
});
