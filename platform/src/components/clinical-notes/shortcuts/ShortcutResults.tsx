'use client';

/**
 * The shortcut list. It renders under the section's heading, in normal flow —
 * opening it pushes the note down and closing it gives the space back, so it
 * never covers the document being written.
 *
 * `onMouseDown` is prevented so that clicking a row does not blur the search
 * box first: the blur would close the list out from under the click.
 */

import type { ShortcutSearch } from './useShortcutSearch';

export default function ShortcutResults({ search }: { search: ShortcutSearch }) {
  if (!search.open) return null;

  return (
    <div
      id="cn-shortcut-results"
      role="listbox"
      aria-label="Text shortcut suggestions"
      className="cn-shortcut-results"
      onMouseDown={e => e.preventDefault()}
    >
      {search.loading && <p className="cn-popover-empty">Loading…</p>}

      {!search.loading && search.results.length === 0 && (
        <p className="cn-popover-empty">
          {search.empty
            ? 'No shortcuts yet. Save one from a section to reuse it here.'
            : 'No shortcut matches that search.'}
        </p>
      )}

      {!search.loading && search.results.map(shortcut => (
        <button
          key={shortcut._id}
          type="button"
          className="cn-popover-item"
          onClick={() => search.choose(shortcut)}
        >
          {shortcut.name}
          <span className="cn-popover-item-body">{shortcut.body}</span>
        </button>
      ))}
    </div>
  );
}
