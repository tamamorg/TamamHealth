/**
 * @jest-environment node
 *
 * Desktop and mobile are two renderers of one module directory. These source
 * assertions pin the wiring that previously drifted: desktop removed its
 * shortcuts from “all modules”, while mobile ignored disabled apps and the
 * feature catalog entirely.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('module directory wiring', () => {
  const desktop = read('src/components/ehr/EhrTopRail.tsx');
  const mobile = read('src/components/mobile/sheets/MobileModulesSheet.tsx');

  test('desktop keeps the complete authorized list in the module dropdown', () => {
    expect(desktop).toContain('groupNavItemsBySection(navItems)');
    expect(desktop).not.toContain('navItems.filter(item => !headerShortcutHrefs.has(item.href))');
  });

  test.each([['desktop', desktop], ['mobile', mobile]])(
    '%s applies both organization app settings and catalog cutovers',
    (_surface, source) => {
      expect(source).toContain('isAppDisabled(item.href, disabledRoutes)');
      expect(source).toContain('applyFeatureCatalogToNavigation(');
      expect(source).toContain('href => isHrefAllowed(href, allowedRoutes)');
    },
  );
});
