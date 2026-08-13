/**
 * @jest-environment node
 *
 * The colour system's invariants, enforced rather than documented.
 *
 * Three things kept going wrong before this suite existed:
 *   1. `lib/theme-colors.ts` and `globals.css` drifted — `danger` was #C44536
 *      in one and #DC2626 in the other, so the same word meant two reds.
 *   2. One meaning acquired many colours: ten distinct reds, eleven greens and
 *      ten ambers were in use across the app for success/warning/danger.
 *   3. Status colours were used at the wrong strength, so the most urgent text
 *      on a screen was the least readable (#F87171 as text scores 2.77:1).
 *
 * Each test below fails on exactly one of those.
 */

import fs from 'fs';
import path from 'path';
import { THEME_COLORS } from '@/lib/theme-colors';

const CSS = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Resolve a token to a hex, following `var(--other)` chains inside :root. */
function token(name: string): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    if (seen.has(current)) throw new Error(`circular token chain at --${current}`);
    seen.add(current);
    const re = new RegExp(`^\\s*--${current}:\\s*([^;]+);`, 'm');
    const match = CSS.match(re);
    if (!match) throw new Error(`token --${current} not found in globals.css`);
    const value = match[1].trim();
    const chained = value.match(/^var\(--([a-z0-9-]+)\)$/i);
    if (!chained) return value.toUpperCase();
    current = chained[1];
  }
}

// ── Contrast, per WCAG 2.1 relative luminance ──────────────────────────────
const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#FFFFFF';

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the JS mirror matches globals.css', () => {
  // Anything a JS consumer can get wrong by drifting from the cascade.
  const MIRRORED: [keyof typeof THEME_COLORS, string][] = [
    ['brandPrimary', 'tb-blue-900'],
    ['brandSecondary', 'tb-blue-800'],
    ['brandOrange', 'accent-orange'],
    ['brandPurple', 'accent-purple'],
    ['info', 'color-info'],
    ['infoStrong', 'color-info-text'],
    ['infoLight', 'tb-blue-100'],
    ['success', 'color-success'],
    ['successStrong', 'color-success-text'],
    ['warning', 'color-warning'],
    ['warningStrong', 'color-warning-text'],
    ['danger', 'color-danger'],
    ['dangerStrong', 'color-danger-text'],
  ];

  test.each(MIRRORED)('THEME_COLORS.%s equals --%s', (key, cssToken) => {
    expect(THEME_COLORS[key].toUpperCase()).toBe(token(cssToken));
  });
});

describe('the two-tone rule holds', () => {
  // BASE is for icons, borders, fills and large text: 3:1 is the bar.
  test.each([
    ['success', THEME_COLORS.success],
    ['warning', THEME_COLORS.warning],
    ['danger', THEME_COLORS.danger],
    ['info', THEME_COLORS.info],
  ])('%s base clears 3:1 on white', (_name, hex) => {
    expect(contrast(hex, WHITE)).toBeGreaterThanOrEqual(3);
  });

  // STRONG carries normal-size text, in both directions: coloured-on-white
  // (a value in a table) and white-on-coloured (a toast, a filled pill).
  test.each([
    ['successStrong', THEME_COLORS.successStrong],
    ['warningStrong', THEME_COLORS.warningStrong],
    ['dangerStrong', THEME_COLORS.dangerStrong],
    ['infoStrong', THEME_COLORS.infoStrong],
  ])('%s clears 4.5:1 against white, both directions', (_name, hex) => {
    expect(contrast(hex, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  test('the strong variant is always the darker of the pair', () => {
    for (const [base, strong] of [
      [THEME_COLORS.success, THEME_COLORS.successStrong],
      [THEME_COLORS.warning, THEME_COLORS.warningStrong],
      [THEME_COLORS.danger, THEME_COLORS.dangerStrong],
      [THEME_COLORS.info, THEME_COLORS.infoStrong],
    ]) {
      expect(luminance(strong)).toBeLessThan(luminance(base));
    }
  });
});

describe('var() fallbacks tell the truth', () => {
  // `var(--token, #hex)` is the right way to hold a literal, but only while the
  // literal matches the token. Forty-five did not: --color-danger fell back to
  // #DA1E28 in the payment pages, and worst, EmptyState fell back to #f1f5f9
  // for --text-primary — near-white text on a white card if the var ever
  // failed to resolve.
  function resolve(name: string, depth = 0): string | null {
    if (depth > 8) return null;
    const m = CSS.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'));
    if (!m) return null;
    const value = m[1].trim();
    const chained = value.match(/^var\(--([a-z0-9-]+)\)$/i);
    if (chained) return resolve(chained[1], depth + 1);
    return value.startsWith('#') ? value : null;
  }
  const expand = (h: string) => {
    const v = h.replace('#', '');
    return '#' + (v.length === 3 ? [...v].map(c => c + c).join('') : v).toUpperCase();
  };

  test('every fallback equals the token it stands in for', () => {
    const root = path.join(process.cwd(), 'src');
    const bad: string[] = [];
    for (const file of walkFiles(root)) {
      const rel = path.relative(root, file);
      if (rel.includes('__tests__')) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const m of source.matchAll(/var\(--([a-z0-9-]+),\s*(#[0-9A-Fa-f]{3,8})\)/gi)) {
        const real = resolve(m[1]);
        if (real && expand(real) !== expand(m[2])) {
          bad.push(`${rel}: var(--${m[1]}, ${m[2]}) but --${m[1]} is ${real}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('one meaning, one colour', () => {
  // The retired hexes. Each was a second (or tenth) way to say success,
  // warning or danger; several also failed contrast where they were used.
  const RETIRED: Record<string, string> = {
    '#EF4444': 'danger', '#F87171': 'danger', '#E34948': 'danger',
    '#DA1E28': 'danger', '#C44536': 'danger', '#C24135': 'danger',
    '#B3251E': 'danger', '#B91C1C': 'danger',
    '#199E70': 'success', '#1B9E77': 'success', '#14713A': 'success',
    '#10B944': 'success', '#1F9D6F': 'success', '#167755': 'success',
    '#16A34A': 'success', '#22C55E': 'success', '#047857': 'success',
    '#B8741C': 'warning', '#EDA100': 'warning', '#B45309': 'warning',
    '#F59E0B': 'warning', '#B26A00': 'warning', '#CA8A04': 'warning',
    '#A16207': 'warning', '#8A5A00': 'warning',
  };

  /** Files that legitimately hold colour literals — see theme-colors.ts. */
  const ALLOWED = [
    'lib/theme-colors.ts',            // the mirror itself
    'lib/services/receipt-service.ts', // standalone print document, no cascade
    'app/global-error.tsx',            // replaces the root layout
    '__tests__/design/color-tokens.test.ts',
  ];

  test('no retired status hex survives in the app', () => {
    const root = path.join(process.cwd(), 'src');
    const offenders: string[] = [];
    for (const file of walkFiles(root)) {
      const rel = path.relative(root, file);
      if (ALLOWED.some(a => rel.endsWith(a) || rel.includes(a))) continue;
      const source = fs.readFileSync(file, 'utf8')
        // A comment naming a retired hex is how we record WHY it is retired —
        // triage-display.ts documents the two-reds bug that created the rule.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        // A hex inside `var(--token, #hex)` is a documented fallback, not a
        // hardcoded colour — the cascade still decides.
        .replace(/var\(--[a-z0-9-]+,\s*#[0-9A-Fa-f]{3,8}\)/gi, '');
      for (const [hex, meaning] of Object.entries(RETIRED)) {
        if (new RegExp(hex, 'i').test(source)) {
          offenders.push(`${rel}: ${hex} — use the ${meaning} token instead`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
