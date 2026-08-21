/**
 * @jest-environment node
 *
 * The colour system's invariants, enforced rather than documented.
 *
 * Four things kept going wrong before this suite existed:
 *   1. `lib/theme-colors.ts` and `globals.css` drifted — `danger` was #C44536
 *      in one and #DC2626 in the other, so the same word meant two reds.
 *   2. One meaning acquired many colours: ten distinct reds, eleven greens and
 *      ten ambers were in use across the app for success/warning/danger.
 *   3. Status colours were used at the wrong strength, so the most urgent text
 *      on a screen was the least readable (#F87171 as text scores 2.77:1).
 *   4. Colours entered from nowhere. The app carried 344 distinct hexes — six
 *      unrelated blues, a Tailwind slate, three teals, two violets and a rose,
 *      none of them a brand decision. `the palette holds` below is the gate:
 *      globals.css may only contain the nine palette colours, the ramps mixed
 *      from them, and the two documented exceptions.
 *
 * Each test below fails on exactly one of those.
 */

import fs from 'fs';
import path from 'path';
import { THEME_COLORS } from '@/lib/theme-colors';
import { accessibleOnColor } from '@/lib/branding';
import { CHART_SERIES_HEX } from '@/lib/chart-colors';

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
  // #DC2626 in the payment pages, and worst, EmptyState fell back to #F1F5F9
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

describe('the chart scale', () => {
  // The choropleth interpolates with parseInt(hex.slice(...)), so it needs
  // literals; every other caller uses the var() form. The two must agree or
  // a chart and a map show different colours for the same series.
  test.each([0, 1, 2, 3, 4, 5])('CHART_SERIES_HEX[%i] equals its --chart-* token', i => {
    expect(CHART_SERIES_HEX[i].toUpperCase()).toBe(token(`chart-${i + 1}`));
  });

  test('every slot clears 3:1 on the card surface', () => {
    // Cards are pure white; the cream ground is behind them.
    const CARD = '#FFFFFF';
    for (const hex of CHART_SERIES_HEX) {
      expect(contrast(hex, CARD)).toBeGreaterThanOrEqual(3);
    }
  });

  test('no status colour is used as a series slot', () => {
    const status = ['color-success', 'color-warning', 'color-danger'].map(t => token(t));
    for (const hex of CHART_SERIES_HEX) {
      expect(status).not.toContain(hex.toUpperCase());
    }
  });

  test('the sequential ramp is one hue, light to dark', () => {
    const steps = [1, 2, 3, 4, 5].map(i => token(`chart-seq-${i}`));
    const lums = steps.map(luminance);
    for (let i = 1; i < lums.length; i++) expect(lums[i]).toBeLessThan(lums[i - 1]);
  });
});

describe('one meaning, one colour', () => {
  // The retired hexes. Each was a second (or tenth) way to say success,
  // warning or danger; several also failed contrast where they were used.
  const RETIRED: Record<string, string> = {
    '#C44536': 'danger', '#F87171': 'danger', '#EF4444': 'danger',
    '#DC2626': 'danger', '#C0392B': 'danger', '#E53935': 'danger',
    '#B91C1C': 'danger', '#8B2E24': 'danger', '#B93328': 'danger',
    '#059669': 'success', '#1B9E77': 'success', '#047857': 'success',
    '#A7F3D0': 'success', '#4CAF50': 'success', '#22C55E': 'success',
    '#16A34A': 'success', '#15795C': 'success', '#167755': 'success',
    '#D97706': 'warning', '#FB923C': 'warning', '#B8741C': 'warning',
    '#F59E0B': 'warning', '#C2410C': 'warning', '#E4A84B': 'warning',
    '#9C5E16': 'warning', '#92400E': 'warning', '#B45309': 'warning',
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

describe('the palette holds', () => {
  // The nine, and only the nine. Every other colour in the product is one of
  // these or a measured mix of two, so "what colour is this?" always has an
  // answer that points back here.
  const NINE = [
    '#FCFEF3', '#C9F4FF', '#FDD95F', '#FF7F00', '#1E90FF',
    '#2191D0', '#015697', '#113055', '#001D3F',
  ];

  // Rungs mixed from the nine. Each is a documented step of one ramp; the
  // comment beside it in globals.css says which two colours produced it.
  const DERIVED = [
    // blue ramp
    '#F2FCFF', '#E1F9FF', '#7CC7FF', '#1174B4',
    // neutrals — the navy diluted into white
    '#FAFBFC', '#F5F7F8', '#F1F3F5', '#ECEEF1', '#E2E6EB', '#D9DEE4',
    '#CFD6DD', '#B3BDC9', '#94A2B3', '#6B7F96', '#5D728B', '#546A85',
    '#3C5574', '#2E4969',
    // deep surfaces — the navy lifted toward the deep blue
    '#1B4270', '#244B75', '#35608C',
    // orange, darkened toward black so it stays saturated
    '#FFF5EB', '#FFEDDB', '#FFE3C7', '#FFD2A6', '#FF9933',
    '#E67200', '#CC6600', '#B35900', '#A65300',
    // gold, diluted into white
    '#FFFCF2', '#FFFAE9', '#FFF7DC', '#FEF2C7', '#FEE697', '#B19843',
    // cream, the ground
    '#FEFFFB', '#F7FBE4',
  ];

  // Exception 1: clinical safety. Red/amber/green is how ETAT triage, allergy
  // alerts and abnormal labs are read at a glance, and the palette has no red
  // or green. Exception 2: the chart scale needs six hues that stay apart
  // under colour-vision deficiency, which six steps of one blue cannot do.
  const CLINICAL = [
    '#4FC79B', '#0FA06A', '#0E9463', '#0B8557', '#0A6E4A', '#08573A',
    '#ECF6F3', '#E2F2EC', '#D8EEE6',
    '#F26D64', '#E03127', '#D92B20', '#B4180F', '#9E1B14', '#7E150F',
    '#FCEEED', '#FAE6E4', '#F9DDDB',
  ];
  const CHART_EXCEPTION = ['#BE185D', '#0D9488', '#6D45C2'];

  const ALLOWED = new Set([
    '#FFFFFF', '#000000',
    ...NINE, ...DERIVED, ...CLINICAL, ...CHART_EXCEPTION,
  ]);

  test('globals.css introduces no colour outside the palette', () => {
    const stray = [...new Set(
      (CSS.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map(h => h.toUpperCase()),
    )].filter(h => !ALLOWED.has(h));
    expect(stray).toEqual([]);
  });

  test('no component introduces a colour globals.css does not know', () => {
    const root = path.join(process.cwd(), 'src');
    const offenders: string[] = [];
    for (const file of walkFiles(root)) {
      const rel = path.relative(root, file);
      if (rel.includes('__tests__')) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const hex of new Set((source.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map(h => h.toUpperCase()))) {
        if (!ALLOWED.has(hex)) offenders.push(`${rel}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the nine are reachable as tokens', () => {
    const NAMED: [string, string][] = [
      ['tm-cream', '#FCFEF3'], ['tm-ice', '#C9F4FF'], ['tm-gold', '#FDD95F'],
      ['tm-orange', '#FF7F00'], ['tm-dodger', '#1E90FF'], ['tm-blue', '#2191D0'],
      ['tm-deep', '#015697'], ['tm-navy', '#113055'], ['tm-ink', '#001D3F'],
    ];
    for (const [name, hex] of NAMED) expect(token(name)).toBe(hex);
  });

  test('the accent carries white text and the warm pair carries dark ink', () => {
    // Orange and gold are used at full strength; accessibility comes from
    // flipping the foreground, not from darkening the brand colour.
    expect(contrast(token('accent-primary'), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent-orange'), token('accent-orange-on'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent-gold'), token('accent-gold-on'))).toBeGreaterThanOrEqual(4.5);
  });
});
