/**
 * @jest-environment node
 *
 * Dark-mode guardrails. Runtime surfaces must use semantic tokens; literal
 * paper colours are reserved for the isolated documents we print.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const GLOBALS = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');

function walk(dir: string, extensions: RegExp, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, extensions, out);
    else if (extensions.test(entry.name)) out.push(full);
  }
  return out;
}

const LIGHT_BACKGROUND = /background(?:-color)?\s*:\s*(?:white\b|#fff(?:fff)?\b|#(?:fafbfc|f5f7f8|f1f3f5|eceef1|e2e6eb|d9dee4|cfd6dd|f2fcff|e1f9ff|c9f4ff)\b)/gi;

const PRINT_DOCUMENTS = new Set([
  'app/(dashboard)/billing/[id]/page.tsx',
  'app/(dashboard)/pharmacy/page.tsx',
  'components/PrintListDialog.tsx',
  'components/PublicLegalShell.tsx',
  'components/patients/BillingTab.tsx',
  'components/patients/PatientDetailPage.tsx',
  'lib/services/receipt-service.ts',
]);

const channel = (value: number) => value / 255 <= 0.04045
  ? value / 255 / 12.92
  : ((value / 255 + 0.055) / 1.055) ** 2.4;

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

describe('dark theme coverage', () => {
  it('does not pin runtime stylesheets to light surface literals', () => {
    const offenders = walk(SRC, /\.css$/).flatMap(file => {
      const source = fs.readFileSync(file, 'utf8');
      return source.match(LIGHT_BACKGROUND) ? [path.relative(SRC, file)] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('keeps light surface literals in print documents only', () => {
    const offenders = walk(SRC, /\.tsx?$/).flatMap(file => {
      const source = fs.readFileSync(file, 'utf8');
      return source.match(LIGHT_BACKGROUND) ? [path.relative(SRC, file)] : [];
    });
    expect(new Set(offenders)).toEqual(PRINT_DOCUMENTS);
  });

  it('overrides semantic, status, legacy surface, and focus tokens', () => {
    expect(GLOBALS).toMatch(/:root\[data-theme="dark"\]\s*\{/);
    for (const token of [
      'bg-app', 'bg-card-solid', 'bg-input', 'text-primary', 'text-muted',
      'border-light', 'accent-text', 'focus-ring', 'color-success-text',
      'color-warning-text', 'color-danger-text', 'color-info-bg', 'brand-50',
      'orange-100', 'gold-200',
    ]) {
      expect(GLOBALS).toMatch(new RegExp(`:root\\[data-theme="dark"\\][\\s\\S]*?--${token}:`));
    }
  });

  it.each([
    ['primary text', '#FBFEFF', '#113055', 4.5],
    ['muted text', '#94A2B3', '#113055', 4.5],
    ['link text', '#7CC7FF', '#113055', 4.5],
    ['danger text', '#F26D64', '#113055', 4.5],
    ['success text', '#4FC79B', '#113055', 4.5],
    ['warning text', '#FEE697', '#113055', 4.5],
    ['focus indicator', '#7CC7FF', '#001D3F', 3],
  ])('%s clears its WCAG contrast target', (_name, foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});
