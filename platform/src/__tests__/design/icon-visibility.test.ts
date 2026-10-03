/**
 * @jest-environment node
 *
 * An icon must not be drawn in the colour of the surface it sits on.
 *
 * A default icon is painted in the accent colour (the Icon component writes it
 * as a literal `stroke=` attribute), so on any button whose fill IS the accent
 * colour the glyph disappears: a blank square before "Sign", before "Pause
 * visit & close", before the lab order's "Next". The cure is a CSS rule that
 * makes the icon take the surface's own ink — and for years that rule was a
 * list someone extended each time a blank square was noticed.
 *
 * This reads every stylesheet, finds each selector that paints a solid dark or
 * brand fill with white text, and requires it to be either in the one
 * icon-on-fill list in globals.css, covered by its own svg rule, or listed
 * below as a surface that never holds an icon. A new solid button therefore
 * fails here until its icons are handled.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');

function stylesheets(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const SOLID_FILL = /background(?:-color)?\s*:\s*(?:var\(--(?:accent-primary|accent-hover|tamamhealth-blue|tm-navy|tamam-btn-bg|color-danger|navy|bl-teal|accent-strong|primary)[^)]*\)|#(?:015697|113055|001d3f|0a3a66|d92b20|b35900|0e9463)\b)/i;
const WHITE_INK = /(?:^|[;{\s])color\s*:\s*(?:#fff(?:fff)?\b|white\b|var\(--color-white\))/i;

/** Solid white-text surfaces that never contain an icon, or handle it themselves. */
const NO_ICON = new Set([
  'body button[style*="gradient"]', 'body a[style*="gradient"]', // inline gradients; their icons carry .text-white
  '.th-badge', '.skip-link', '.ehr-avatar', '.ehr-module-account-avatar',
  '.rbc-tamam .rbc-header.rbc-today a', '.rbc-tamam .rbc-header.rbc-today span',
  '.rbc-tamam .rbc-date-cell.rbc-now a', '.rbc-tamam .rbc-header .gcal-colhead-date.is-today',
  '.msgs-bubble--mine', '.pp-bubble-line.me .pp-bubble', '.civ-marker', '.civ-label-list li>span',
  // Covered by a dedicated svg rule of their own:
  '.btn-primary', '.appt-edit-header-actions .btn-primary', '.pp-btn-primary', '.sadb-btn-danger',
  '.ehr-schedule-actions button.primary', '.listpage-icon-btn-primary', '.ehr-visit-pop-icon.is-primary',
  '.ehr-schedule-actions .ehr-rail-menu-trigger-primary', '.ehr-queue-move-footer button.primary.danger',
  '.cn-footer .cn-btn-primary', '.cn-footer .cn-btn-save',
  // A state of a selector the list already holds:
  '.ehr-rail-menu-trigger-primary.open',
  '.modal-portal-backdrop .ehr-handoff-modal > .ehr-handoff-head',
  '.tamam-root :is(.tamam-section-toggle button.is-active, .tamam-activity-filters button.is-active)',
]);

function solidWhiteTextSelectors(): { file: string; selector: string }[] {
  const found: { file: string; selector: string }[] = [];
  for (const file of stylesheets(SRC)) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = rule.exec(css))) {
      const body = match[2];
      if (!SOLID_FILL.test(body) || !WHITE_INK.test(body)) continue;
      const selectors = match[1].trim().replace(/\s+/g, ' ');
      if (selectors.startsWith('@')) continue;
      // Split a selector list on top-level commas only.
      let depth = 0; let current = '';
      const parts: string[] = [];
      for (const ch of selectors) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
      }
      parts.push(current.trim());
      for (const selector of parts) {
        if (/svg|::|:hover|:active|:focus|:disabled|\[disabled/.test(selector)) continue;
        found.push({ file: path.relative(SRC, file), selector });
      }
    }
  }
  return found;
}

function iconOnFillList(): string[] {
  const globals = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
  const block = globals.slice(globals.indexOf('ICON-ON-FILL:START'), globals.indexOf('ICON-ON-FILL:END'));
  const list = block.slice(block.indexOf(':is(') + 4, block.lastIndexOf(') svg.lucide'));
  return list.split(',\n').map(selector => selector.trim()).filter(Boolean);
}

describe('icons on solid surfaces', () => {
  it('has one list, and its rule repaints the stroke in the surface\'s ink', () => {
    const globals = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    const block = globals.slice(globals.indexOf('ICON-ON-FILL:START'), globals.indexOf('ICON-ON-FILL:END'));
    expect(block).toMatch(/\) svg\.lucide \{\s*color: inherit !important;\s*stroke: currentColor !important;/);
    const list = iconOnFillList();
    expect(list.length).toBeGreaterThan(30);
    // The buttons this was first reported on.
    for (const selector of ['.cn-btn-primary', '.cn-btn-save', '.labord-btn--primary', '.labord-toggle--on']) {
      expect(list).toContain(selector);
    }
  });

  it('covers every solid white-text control in the stylesheets', () => {
    const list = new Set(iconOnFillList());
    const uncovered = solidWhiteTextSelectors()
      .filter(({ selector }) => !list.has(selector) && !NO_ICON.has(selector))
      .map(({ file, selector }) => `${file}: ${selector}`);
    // Add the selector to the ICON-ON-FILL list in globals.css — or, if it
    // can never hold an icon, to NO_ICON above with the reason.
    expect([...new Set(uncovered)]).toEqual([]);
  });

  it('finds the surfaces it is meant to — the scan is real', () => {
    const selectors = solidWhiteTextSelectors().map(({ selector }) => selector);
    expect(selectors.length).toBeGreaterThan(40);
    expect(selectors).toContain('.cn-btn-primary');
    expect(selectors).toContain('.labord-btn--primary');
  });
});
