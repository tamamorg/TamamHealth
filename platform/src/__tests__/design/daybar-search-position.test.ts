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
 * does.
 *
 * ── Revised 2026-08-20 ─────────────────────────────────────────────────────
 * The original fix made BOTH side tracks flexible, and that turned out to cause
 * a worse bug than the one it cured. The lane row is ~406px of buttons that
 * cannot shrink; `1fr` sized its track from leftover space, which in an 806px
 * card is 222px. The buttons overflowed the track and `justify-self: end` sent
 * that overflow LEFTWARD, laying "UPCOMING · 0" across the right-hand end of
 * the search field — 149px of overlap at a 1440px viewport.
 *
 * So the invariant this file guards is unchanged — the field must not move when
 * the day changes — but it is now enforced at the source instead of the track:
 * the counts render into `.ehr-day-tab-count`, a fixed-width cell, so 7 -> 24 is
 * the same number of pixels and the lane row simply does not change size. That
 * makes `max-content` safe on the lane track, and `max-content` is what stops
 * the track being squeezed under its own contents.
 *
 * The TITLE track stays flexible: the date is free-form text with no such cell,
 * so content-sizing it would still drag the field.
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
  test('a three-track daybar never sizes its TITLE track to its own content', () => {
    // The date is free-form text with no fixed-width cell behind it, so a
    // content-sized title track still drags the field when the day changes.
    const threeTrack = daybarColumnRules().filter(r => tracks(r.columns).length >= 3);
    expect(threeTrack.length).toBeGreaterThan(0);

    const CONTENT_SIZED = /^(auto|min-content|max-content|fit-content)/;
    const offenders = threeTrack
      .filter(({ columns }) => CONTENT_SIZED.test(tracks(columns)[0]))
      .map(({ selector, columns }) => `${selector} -> ${tracks(columns)[0]}`);
    expect(offenders).toEqual([]);
  });

  test('the LANE track is max-content, so the tabs can never cover the field', () => {
    // `1fr` sized this track from leftover space and the tabs overflowed it
    // onto the search box. `auto` is not enough either — an `auto` track still
    // shrinks below its contents when the row is short of room, which
    // reproduced the same overlap at a smaller size.
    const threeTrack = daybarColumnRules().filter(r => tracks(r.columns).length >= 3);
    const lanes = threeTrack.map(({ selector, columns }) => {
      const t = tracks(columns);
      return `${selector} -> ${t[t.length - 1]}`;
    });
    expect(lanes.every(l => l.endsWith('-> max-content'))).toBe(true);
  });

  test('the lane counts render into a fixed-width cell', () => {
    // This is what makes `max-content` safe on the lane track: the row's width
    // stops depending on how many digits a count happens to have.
    const cell = /\.ehr-day-tab-count\s*\{([^}]*)\}/.exec(CSS)?.[1] || '';
    expect(/min-width:\s*\d/.test(cell)).toBe(true);

    // Both daybars must actually use it, or their row resizes on every count.
    for (const file of [
      'src/components/ehr/EhrClinicalDashboard.tsx',
      'src/components/ehr/EhrCareDashboard.tsx',
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(src).toContain('ehr-day-tab-count');
    }
  });

  test('the winning rule for a daybar WITH a search box pins the centre track', () => {
    // Last one in source order wins among equal-specificity rules, and this
    // selector is the most specific set in the file.
    const withSearch = daybarColumnRules().filter(r =>
      r.selector.includes(':has(.ehr-queue-search)') && !r.selector.includes(':not('));
    expect(withSearch).not.toHaveLength(0);

    const winner = withSearch[withSearch.length - 1];
    // Title absorbs the slack, the centre is the field's own documented width,
    // and the lanes take exactly what they need and no less.
    expect(tracks(winner.columns)).toEqual([
      'minmax(148px, 1fr)', 'minmax(0, 330px)', 'max-content',
    ]);
  });

  test('the stacking breakpoint is a container query, not a viewport one', () => {
    // The daybar's width is `.ehr-center-panel`'s — a workspace-grid track that
    // is 806px inside a 1440px viewport. A `@media` breakpoint measures the
    // wrong box and fires at the wrong time.
    expect(/\.ehr-center-panel\s*\{[^}]*container-type:\s*inline-size/.test(CSS)).toBe(true);
    const stacking = /@container[^{]*\{[^]*?\.ehr-daybar[^]*?grid-template-columns:\s*minmax\(0, 1fr\);/.test(CSS);
    expect(stacking).toBe(true);
  });

  test('the field width and its grid track agree', () => {
    // `.ehr-queue-search` caps itself at 330px "because the grid gives it a
    // 330px track". If one moves without the other the field stops being
    // centred in its column.
    const field = /\.ehr-queue-search\s*\{([^}]*)\}/.exec(CSS)?.[1] || '';
    expect(/max-width:\s*330px/.test(field)).toBe(true);
  });
});
