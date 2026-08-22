'use client';

/**
 * The shortcut search box — a control the size of the other buttons in the
 * section's tool row, not a full-width field. Clicking it shows the section's
 * shortcuts; typing narrows them.
 */

import { Search } from '@/components/icons/lucide';
import type { ShortcutSearch } from './useShortcutSearch';

export default function ShortcutSearchInput({ search }: { search: ShortcutSearch }) {
  return (
    <div className="cn-shortcut-field">
      <Search size={12} aria-hidden />
      <input
        className="cn-shortcut-input"
        placeholder="Shortcut…"
        value={search.query}
        aria-label="Search text shortcuts"
        // Without role="combobox" this is a plain textbox, which has no
        // expanded state — so aria-expanded was announced as nothing and a
        // screen-reader user never heard the suggestion list open.
        role="combobox"
        aria-controls="cn-shortcut-results"
        aria-expanded={search.open}
        onFocus={search.openList}
        onClick={search.openList}
        onChange={(e) => { search.openList(); search.setQuery(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); search.close(); }
          if (e.key === 'Enter' && search.results.length > 0) {
            e.preventDefault();
            search.choose(search.results[0]);
          }
        }}
      />
    </div>
  );
}
