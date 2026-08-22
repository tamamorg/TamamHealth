/**
 * What a tenant sets is what a tenant gets — on save, and after the reload.
 *
 * Branding is applied in three places (login, session restore, and the
 * branding editor's own live preview). The editor used to build its CSS
 * variables from the raw form fields while the other two ran them through
 * `getOrgBranding` first, so a value the resolver rejects looked applied until
 * the next sign-in silently dropped it. These pin the two properties that
 * failure mode depends on: one resolver for every caller, and tokens that are
 * still colours whatever legal hex shape the operator typed.
 */

import {
  getOrgBranding, brandingFromFields, brandingToCSSVars, isUsableBrandColor, DEFAULT_BRANDING,
} from '@/lib/branding';
import type { OrganizationDoc } from '@/lib/db-types';

const org = (over: Partial<OrganizationDoc>): OrganizationDoc => ({
  _id: 'org-1',
  type: 'organization',
  name: 'Mercy Hospital Group',
  ...over,
} as unknown as OrganizationDoc);

/** Every token whose value is derived by appending an alpha pair. */
const TINT_TOKENS = ['--accent-light', '--accent-border'] as const;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

describe('a brand colour survives the round trip', () => {
  test('the editor and the session resolve the same fields identically', () => {
    const fields = {
      name: 'Mercy Hospital Group',
      primaryColor: '#7C3AED',
      secondaryColor: '#5B21B6',
      accentColor: '#3D8B7A',
    };
    expect(brandingFromFields(fields)).toEqual(getOrgBranding(org(fields)));
  });

  test('a value the resolver rejects is reported before it is saved', () => {
    // The hex field beside each swatch is free text: this is the check that
    // stops "I set it, it looked right, then it went back to blue".
    for (const bad of ['blue', 'var(--accent-primary)', 'rgb(1,2,3)', '']) {
      expect(isUsableBrandColor(bad)).toBe(false);
      expect(brandingFromFields({ name: 'x', primaryColor: bad }).primaryColor)
        .toBe(DEFAULT_BRANDING.primaryColor);
    }
    for (const good of ['#abc', '#ABCDEF', '#1174b4']) {
      expect(isUsableBrandColor(good)).toBe(true);
    }
  });

  test('shorthand hex still yields colours, not 5-character strings', () => {
    // `#abc` is legal CSS and the picker's text field accepts it; the tints
    // are built as `${primary}12`, which turned it into `#abc12`.
    const vars = brandingToCSSVars(brandingFromFields({ name: 'x', primaryColor: '#abc' }));
    expect(vars['--accent-primary']).toBe('#aabbcc');
    for (const token of TINT_TOKENS) expect(vars[token]).toMatch(HEX);
  });

  test('an 8-digit hex does not grow a second alpha pair', () => {
    const vars = brandingToCSSVars(brandingFromFields({ name: 'x', primaryColor: '#1174b4ff' }));
    for (const token of TINT_TOKENS) expect(vars[token]).toMatch(HEX);
  });

  test('the accent system, and the ink on it, both come from the brand', () => {
    // A pale brand must not keep white labels: `--accent-on` is what the
    // tenant card's primary action paints its text and icon with.
    const pale = brandingToCSSVars(brandingFromFields({ name: 'x', primaryColor: '#FFE9A8', secondaryColor: '#FFD35C' }));
    expect(pale['--accent-primary']).toBe('#FFE9A8');
    expect(pale['--accent-on']).toBe('#113055');

    const dark = brandingToCSSVars(brandingFromFields({ name: 'x', primaryColor: '#113055', secondaryColor: '#0B2340' }));
    expect(dark['--accent-on']).toBe('#FFFFFF');
  });

  test('the retired platform blue is treated as unset, not as a brand', () => {
    expect(brandingFromFields({ name: 'x', primaryColor: '#2191D0' }).primaryColor)
      .toBe(DEFAULT_BRANDING.primaryColor);
  });
});
