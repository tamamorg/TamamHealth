'use client';

/**
 * Sortable column headers on every table and card-grid list in the app — the
 * OpenMRS O3 header sort. Hovering (or focusing) a header shows ↑↓; clicking
 * it, or Enter / Space, sorts the rows by that column: ascending, then
 * descending, then back to the list's own order. `aria-sort` tells assistive
 * technology which column is sorted, and which way.
 *
 * One delegated enhancer instead of a change in each of ~75 tables: it marks
 * every titled header of a `<table>` (and of a `.appointment-card-head` list)
 * as sortable, reorders the rendered rows by the text they show
 * (lib/table-sort.ts), and keeps the order when the list re-renders — a
 * MutationObserver re-applies the sort after React inserts or removes rows.
 * Moving keyed row elements is safe for React: it inserts new rows before
 * their recorded neighbours and removes rows by reference.
 *
 * Opt-outs: `data-no-sort` on a table, header or list. Headers with no title
 * (a checkbox or actions column) and tables with fewer than two rows are not
 * marked. A table that pages its rows in React sorts its own data instead and
 * carries `data-sort="data"` so the enhancer leaves its rows alone.
 */
import { useEffect } from 'react';
import { compareKeys, nextDirection, sortKey, type SortDirection } from '@/lib/table-sort';
import './table-sort.css';

type Container = HTMLTableSectionElement | HTMLElement;
type State = { column: number; direction: SortDirection };

const state = new WeakMap<Element, State>();
const original = new WeakMap<Element, number>();
let seq = 0;
let applying = false;

const HEADER_SELECTOR = 'table:not([data-no-sort]) > thead > tr > th, .appointment-card-flow:not([data-no-sort]) > .appointment-card-head > *';

function isCardHeader(el: Element): boolean {
  return !!el.parentElement?.classList.contains('appointment-card-head');
}

/** The rows a header sorts, as groups: a data row plus the rows that belong
 *  to it (an expanded detail row, a workflow panel) until the next data row. */
function groupsFor(header: Element): { container: Container; groups: Element[][]; columns: number } | null {
  if (isCardHeader(header)) {
    const flow = header.parentElement?.parentElement;
    if (!flow) return null;
    const groups: Element[][] = [];
    for (const child of Array.from(flow.children)) {
      if (child === header.parentElement) continue;
      if (child.classList.contains('appointment-card-row')) groups.push([child]);
      else if (groups.length) groups[groups.length - 1].push(child);
    }
    return { container: flow, groups, columns: header.parentElement!.children.length };
  }
  const table = header.closest('table');
  const body = table?.tBodies[0];
  if (!table || !body) return null;
  const columns = Array.from((header.parentElement as HTMLTableRowElement).cells).reduce((n, c) => n + (c.colSpan || 1), 0);
  const groups: Element[][] = [];
  for (const row of Array.from(body.rows)) {
    const span = Array.from(row.cells).reduce((n, c) => n + (c.colSpan || 1), 0);
    const isData = row.cells.length > 1 && span === columns;
    if (isData) groups.push([row]);
    else if (groups.length) groups[groups.length - 1].push(row);
  }
  return { container: body, groups, columns };
}

function columnIndex(header: Element): number {
  if (isCardHeader(header)) return Array.from(header.parentElement!.children).indexOf(header);
  let index = 0;
  for (const cell of Array.from((header.parentElement as HTMLTableRowElement).cells)) {
    if (cell === header) return index;
    index += (cell as HTMLTableCellElement).colSpan || 1;
  }
  return index;
}

/** A cell's main value: its first line. Cells stack a sub-line under the
 *  value ("Nov 21, 2025" over "Last visit Jan 4, 2026"); the column sorts by
 *  the value, not the two read as one string. */
function firstLine(text: string): string {
  return text.split('\n').map(line => line.trim()).find(Boolean) || '';
}

function cellText(row: Element, column: number): string {
  return firstLine(rawCellText(row, column));
}

function rawCellText(row: Element, column: number): string {
  if (row instanceof HTMLTableRowElement) {
    let index = 0;
    for (const cell of Array.from(row.cells)) {
      const span = cell.colSpan || 1;
      if (column < index + span) return cell.innerText || cell.textContent || '';
      index += span;
    }
    return '';
  }
  const cells = Array.from(row.children).filter(el => (el as HTMLElement).offsetParent !== null || el.getClientRects().length);
  const cell = cells[column] as HTMLElement | undefined;
  return cell ? (cell.innerText || cell.textContent || '') : '';
}

function headersOf(header: Element): Element[] {
  return Array.from(header.parentElement?.children || []);
}

function sortable(header: Element): boolean {
  if (header.hasAttribute('data-no-sort')) return false;
  if ((header as HTMLTableCellElement).colSpan > 1) return false;
  if (header.querySelector('input, select, button, a, [role="checkbox"]')) return false;
  if (!(header.textContent || '').trim()) return false;
  const table = header.closest('table');
  if (table?.getAttribute('data-sort') === 'data') return false;
  const info = groupsFor(header);
  if (!info || info.groups.length < 2) return false;
  // A column of controls (the ⋮ actions menu, a checkbox) has nothing to sort.
  const column = columnIndex(header);
  return info.groups.some(group => cellText(group[0], column) !== '');
}

/** Mark the sortable headers inside `root` (idempotent). */
function mark(root: ParentNode) {
  root.querySelectorAll(HEADER_SELECTOR).forEach(header => {
    const el = header as HTMLElement;
    const ok = sortable(el);
    if (ok && !el.classList.contains('tm-sortable')) {
      el.classList.add('tm-sortable');
      if (getComputedStyle(el).textAlign === 'end' || getComputedStyle(el).textAlign === 'right' || getComputedStyle(el).justifySelf === 'end') {
        el.classList.add('tm-sortable--end');
      }
      el.tabIndex = 0;
      el.setAttribute('role', el.tagName === 'TH' ? 'columnheader' : 'button');
      if (!el.hasAttribute('aria-sort')) el.setAttribute('aria-sort', 'none');
      el.title = el.title || 'Sort by this column';
    } else if (!ok && el.classList.contains('tm-sortable') && !el.hasAttribute('aria-sort')) {
      el.classList.remove('tm-sortable', 'tm-sortable--end');
    }
  });
}

/** Put the container's rows in the order its sort state asks for. */
function apply(header: Element) {
  const info = groupsFor(header);
  if (!info) return;
  const { container, groups } = info;
  groups.forEach(group => { if (!original.has(group[0])) original.set(group[0], ++seq); });
  const current = state.get(container);
  const ordered = current
    ? groups
      .map(group => ({ group, key: sortKey(cellText(group[0], current.column)), at: original.get(group[0])! }))
      .sort((a, b) => compareKeys(a.key, b.key, current.direction) || a.at - b.at)
      .map(entry => entry.group)
    : [...groups].sort((a, b) => original.get(a[0])! - original.get(b[0])!);
  const flat = ordered.flat();
  const now = groups.flat();
  if (flat.every((el, i) => el === now[i])) return;
  applying = true;
  // Rows go back exactly where the block of rows was: before whatever
  // followed the last one (an empty state, a "load more"), after the head.
  const anchor = now[now.length - 1].nextSibling;
  flat.forEach(el => container.insertBefore(el, anchor));
  applying = false;
}

function onActivate(header: Element) {
  const info = groupsFor(header);
  if (!info) return;
  const column = columnIndex(header);
  const current = state.get(info.container);
  const next = nextDirection(current && current.column === column ? current.direction : null);
  if (next) state.set(info.container, { column, direction: next });
  else state.delete(info.container);
  headersOf(header).forEach(h => { if (h.classList.contains('tm-sortable')) h.setAttribute('aria-sort', 'none'); });
  header.setAttribute('aria-sort', next ?? 'none');
  apply(header);
}

export default function TableSortEnhancer() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    // Headers of a table that sorts its own data (data-sort="data") are
    // React's; the enhancer only drives the ones it marked.
    const sortableHeader = (target: EventTarget | null) => {
      const header = (target as Element | null)?.closest?.('.tm-sortable') as HTMLElement | null;
      return header && !header.closest('[data-sort="data"]') ? header : null;
    };

    const onClick = (event: MouseEvent) => {
      const header = sortableHeader(event.target);
      if (header) onActivate(header);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const header = sortableHeader(event.target);
      if (!header || event.target !== header) return;
      event.preventDefault();
      onActivate(header);
    };

    mark(document);
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (applying || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        mark(document);
        // Keep each sorted list in order after React re-renders it.
        document.querySelectorAll('.tm-sortable[aria-sort="ascending"], .tm-sortable[aria-sort="descending"]').forEach(apply);
        observer.takeRecords();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
