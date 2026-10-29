'use client';

/**
 * Column sort for a table that pages its rows in React — the same O3 header
 * sort as TableSortEnhancer, but on the data, so a sort orders the whole list
 * and not just the page on screen. Give the table `data-sort="data"` (the
 * enhancer then leaves it to this hook), spread `headerProps(i, valueOf)` on
 * each sortable `<th>`, and page `sort(items)` instead of `items`.
 */
import { useCallback, useState, type KeyboardEvent } from 'react';
import { nextDirection, sortByText, type SortDirection } from '@/lib/table-sort';
import './table-sort.css';

export function useColumnSort<T>() {
  const [sort, setSort] = useState<{ column: number; direction: SortDirection; valueOf: (item: T) => string } | null>(null);

  const toggle = useCallback((column: number, valueOf: (item: T) => string) => {
    setSort(current => {
      const next = nextDirection(current && current.column === column ? current.direction : null);
      return next ? { column, direction: next, valueOf } : null;
    });
  }, []);

  const headerProps = (column: number, valueOf: (item: T) => string, align: 'start' | 'end' = 'start') => ({
    className: align === 'end' ? 'tm-sortable tm-sortable--end' : 'tm-sortable',
    'aria-sort': (sort && sort.column === column ? sort.direction : 'none') as 'ascending' | 'descending' | 'none',
    tabIndex: 0,
    onClick: () => toggle(column, valueOf),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(column, valueOf); }
    },
  });

  const apply = useCallback((items: readonly T[]): T[] => (
    sort ? sortByText(items, sort.valueOf, sort.direction) : [...items]
  ), [sort]);

  return { headerProps, sort: apply, active: sort };
}
