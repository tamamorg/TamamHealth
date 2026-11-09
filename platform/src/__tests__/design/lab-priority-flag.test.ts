/**
 * @jest-environment node
 *
 * The STAT / urgent flag on the lab worklist is said in red text.
 *
 * The shared worklist row forces every `.appointment-card-provider > span` to
 * the muted grey with `!important`. The flag is one of those spans, so a plain
 * `.lab-list-surface .lab-priority-flag { color: danger }` lost and a STAT
 * request read as grey caption text. The flag rule has to out-rank that one:
 * `!important`, and a selector at least as specific.
 */
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('lab worklist priority flag', () => {
  it('beats the muted worklist caption colour', () => {
    const match = css.match(/\.lab-list-surface \.appointment-card-row \.appointment-card-provider > span\.lab-priority-flag\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/color:\s*var\(--color-danger-text\)\s*!important/);
    expect(body).toMatch(/font-weight:\s*700\s*!important/);
  });
});
