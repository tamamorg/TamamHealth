import type { OrganizationDoc } from './db-types';
import { BRAND_PRIMARY, BRAND_SECONDARY } from './theme-colors';

export interface OrgBranding {
  name: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export const DEFAULT_BRANDING: OrgBranding = {
  name: 'TamamHealth',
  primaryColor: BRAND_PRIMARY,
  secondaryColor: BRAND_SECONDARY,
  accentColor: BRAND_PRIMARY,
};

/* Orgs saved before the dark-navy rebrand stored the old #2191D0 header blue
   as their primary/accent color. These runtime branding vars override
   --accent-primary on the root element, so a stale stored blue would repaint
   the whole accent system (buttons, floating message dock, …) even after the
   CSS tokens moved to navy. Treat the previous default as "unset" so those
   installations pick up the current brand color. */
const LEGACY_DEFAULT_BLUE = '#2191d0';

/* Only a literal hex color may override the accent system. Some stored org
   docs carried junk like 'var(--accent-primary)' — a self-referential CSS
   var that invalidates the whole accent cascade and repaints buttons with
   whatever leaks through (e.g. the hover indigo). Anything non-hex falls
   back to the default brand color. */
function isHexColor(color: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color.trim());
}

function modernizeColor(color?: string): string | undefined {
  if (!color || !isHexColor(color)) return undefined;
  return color.toLowerCase() !== LEGACY_DEFAULT_BLUE ? color : undefined;
}

export function getOrgBranding(org?: OrganizationDoc | null): OrgBranding {
  if (!org) return DEFAULT_BRANDING;
  return {
    name: org.name,
    logoUrl: org.logoUrl,
    primaryColor: modernizeColor(org.primaryColor) || DEFAULT_BRANDING.primaryColor,
    secondaryColor: modernizeColor(org.secondaryColor) || DEFAULT_BRANDING.secondaryColor,
    accentColor: modernizeColor(org.accentColor) || DEFAULT_BRANDING.accentColor,
  };
}

/**
 * Foreground for text and icons sitting ON a brand colour.
 *
 * The settings buttons used to hardcode the platform blue because a pale org
 * colour left their white label unreadable. Assuming white is the bug: this
 * picks white or the app's dark ink by whichever clears WCAG 4.5:1 against the
 * chosen brand, so a tenant may brand freely without making their own primary
 * actions illegible. Ties go to white.
 */
export function accessibleOnColor(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  if ([r, g, b].some(Number.isNaN)) return WHITE_INK;
  const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const onWhite = 1.05 / (lum + 0.05);
  const onInk = (lum + 0.05) / (DARK_INK_LUMINANCE + 0.05);
  return onWhite >= onInk ? WHITE_INK : DARK_INK;
}

const WHITE_INK = '#FFFFFF';
/** --color-slate-900, the app's darkest text. */
const DARK_INK = '#113055';
const DARK_INK_LUMINANCE = 0.0219;

export function brandingToCSSVars(branding: OrgBranding): Record<string, string> {
  return {
    '--org-primary': branding.primaryColor,
    '--org-secondary': branding.secondaryColor,
    '--org-accent': branding.accentColor,
    // Override the accent system with org branding
    '--accent-primary': branding.primaryColor,
    '--accent-hover': branding.secondaryColor,
    '--accent-light': `${branding.primaryColor}12`,
    '--accent-border': `${branding.primaryColor}30`,
    '--nav-active-bg': branding.primaryColor,
    // Legibility travels with the brand: a pale primary flips its own label to
    // dark ink instead of rendering white-on-white.
    '--accent-on': accessibleOnColor(branding.primaryColor),
    '--accent-on-hover': accessibleOnColor(branding.secondaryColor),
  };
}
