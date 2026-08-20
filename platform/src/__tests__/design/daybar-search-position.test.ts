/**
 * @jest-environment node
 *
 * The queue search field holds still while the day changes.
 *
 * `.ehr-daybar` is a three-track grid — `title | search | lane tabs` — and both
 * SIDE tracks carry content that changes every time the user picks a different
 * date in the mini-calendar:
 *
 *   • the lane tabs render "Label · N" counts, and 24 is a whole character
 *     wider than 7;
 *   • the title is `centerTitle || selectedDateLabel`, so on every station that
 *     does not pass an explicit title it IS the date ("Thursday, August 20" vs
 *     "Wednesday, September 10").
 *
 * Size either side track to its content (`auto`) and the centre track slides —
 * measured at 16px of travel between two ordinary days, which reads as the
 * search box jumping sideways under the cursor.
 *
 * This regressed once already: the base `.ehr-daybar` rule fixed it and a
 * `.ehr-center-panel .ehr-daybar` override ~21,000 lines later silently put
 * `auto` back at higher specificity. A comment did not survive that; this test
 * does. It asserts the LAST rule to set the columns — the one that actually
 * wins — keeps both side tracks flexible.
 */

import fs from 'fs';
import path from 'path';

const CSS = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Split a track list on top-level whitespace: `minmax(0, 1fr)` is ONE track. */
function tracks(columns: string): string[] {
  const out: string[] = [];
  let depth = 0, current = '';
  for (const ch of columns) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) { out.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** Every `grid-template-columns` declared on a `.ehr-daybar` selector, in source order. */
function daybarColumnRules(): { selector: string; columns: string }[] {
  const out: { selector: string; columns: string }[] = [];
  const rule = /([^{}]*\.ehr-daybar[^{}]*)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(CSS)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    const columns = /grid-template-columns:\s*([^;]+);/.exec(match[2])?.[1]?.trim();
    if (columns) out.push({ selector, columns });
  }
  return out;
}

describe('the daybar search field cannot be moved by the day it is showing', () => {
  test('a three-track daybar never sizes a side track to its own content', () => {
    // A two-track daybar (no search box) may end `auto` — there is no centre
    // column for a content-sized side to push around.
    const threeTrack = daybarColumnRules().filter(r => tracks(r.columns).length >= 3);
    expect(threeTrack.length).toBeGreaterThan(0);

    // `auto`, `min-content`, `max-content` and `fit-content` all measure the
    // track's own content — which is what lets a changing count drag the
    // centre column sideways.
    const CONTENT_SIZED = /^(auto|min-content|max-content|fit-content)/;
    const offenders = threeTrack.flatMap(({ selector, columns }) => {
      const t = tracks(columns);
      return [t[0], t[t.length - 1]]
        .filter(track => CONTENT_SIZED.test(track))
        .map(track => `${selector} -> ${track}`);
    });
    expect(offenders).toEqual([]);
  });

  test('the winning rule for a daybar WITH a search box pins the centre track', () => {
    // Last one in source order wins among equal-specificity rules, and this
    // selector is the most specific set in the file.
    const withSearch = daybarColumnRules().filter(r =>
      r.selector.includes(':has(.ehr-queue-search)') && !r.selector.includes(':not('));
    expect(withSearch).not.toHaveLength(0);

    const winner = withSearch[withSearch.length - 1];
    // Sides absorb the slack; the centre is the field's own documented width.
    expect(tracks(winner.columns)).toEqual([
      'minmax(0, 1fr)', 'minmax(0, 330px)', 'minmax(0, 1fr)',
    ]);
  });

  test('the field width and its grid track agree', () => {
    // `.ehr-queue-search` caps itself at 330px "because the grid gives it a
    // 330px track". If one moves without the other the field stops being
    // centred in its column.
    const field = /\.ehr-queue-search\s*\{([^}]*)\}/.exec(CSS)?.[1] || '';
    expect(/max-width:\s*330px/.test(field)).toBe(true);
  });
});
