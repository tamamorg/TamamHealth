/**
 * Phones: the shared list-page toolbar (pharmacy, lab, referrals) must wrap, or
 * the search is squeezed to zero width between the title and the action controls.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('shared list header on phones', () => {
  it('wraps the toolbar and gives the search a full line below 640px', () => {
    const start = css.indexOf('Phones: the search used to be squeezed');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 700);
    expect(block).toContain('@media (max-width: 639px)');
    expect(block).toMatch(/\.ehr-list-header-toolbar \{ flex-wrap: wrap; \}/);
    expect(block).toMatch(/\.ehr-list-header-search \{ flex: 1 1 100%; \}/);
  });
});
