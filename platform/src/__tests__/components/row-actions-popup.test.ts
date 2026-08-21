/**
 * Where the row-actions menu opens.
 *
 * The trailing pencil button was the tab stop AND the anchor; both jobs moved
 * to the row. A keyboard-activated row still fires `click`, but at (0, 0) with
 * no pointer behind it — anchoring naively would park every keyboard user's
 * menu in the corner of the screen, which is the bug these pin.
 */

import { rowActionsAt, rowActionsFromElement, isRowActivationKey } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/RowActionsMenu';

const ACTIONS: RowAction[] = [{ key: 'a', label: 'Edit', onClick: () => {} }];

function rowAt(right: number, bottom: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ right, bottom, left: 0, top: 0, width: right, height: 40, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

describe('anchoring the menu', () => {
  test('a mouse click opens at the pointer', () => {
    expect(rowActionsAt({ clientX: 640, clientY: 300, detail: 1 }, ACTIONS))
      .toMatchObject({ x: 640, y: 300, actions: ACTIONS });
  });

  test('a keyboard-activated row opens against the row, not the corner', () => {
    // Enter on a <button> row: detail 0, coordinates 0,0.
    const el = rowAt(1200, 480);
    const state = rowActionsAt({ clientX: 0, clientY: 0, detail: 0, currentTarget: el }, ACTIONS);
    expect(state.x).toBe(1000);   // right edge less the menu width
    expect(state.y).toBe(480);
  });

  test('a genuine click at the origin is still treated as a pointer', () => {
    // detail >= 1 means a real press happened — the window's top-left corner is
    // an unlikely but legal place to click.
    expect(rowActionsAt({ clientX: 0, clientY: 0, detail: 1, currentTarget: rowAt(900, 40) }, ACTIONS))
      .toMatchObject({ x: 0, y: 0 });
  });

  test('an explicit element anchor sits at the row bottom-right', () => {
    expect(rowActionsFromElement(rowAt(800, 200), ACTIONS)).toMatchObject({ x: 600, y: 200 });
  });
});

describe('which keys open a row', () => {
  test.each(['Enter', ' '])('%p opens it', k => expect(isRowActivationKey(k)).toBe(true));
  test.each(['Tab', 'a', 'ArrowDown', 'Escape'])('%p does not', k => expect(isRowActivationKey(k)).toBe(false));
});
