/**
 * How a table column sorts — the OpenMRS O3 header sort (hover shows ↑↓,
 * click: ascending → descending → back to the list's own order).
 *
 * Pure: compares the text a cell shows. Dates compare as dates, numbers as
 * numbers (a leading number: "38.9 °C", "112 bpm", "120/80"), everything
 * else as natural text ("Bed 2" before "Bed 10"). Cells with nothing in them
 * ("—", "--", "N/A") always sort last, whichever way the column runs.
 */
export type SortDirection = 'ascending' | 'descending';

const EMPTY = /^(?:—|–|-{1,2}|n\/a|none|not recorded|)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const NUMBER = /^[-+]?\d[\d,]*(?:\.\d+)?/;
// "Oct 28, 2026", "28 Oct 2026", "Today, 03:12 AM" — anything Date.parse reads
// that also names a month or is ISO, so "12" or "Bed 4" never parse as dates.
const MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;

export type SortKey = { kind: 0; value: number } | { kind: 1; value: number } | { kind: 2; value: string } | { kind: 3 };

/** The comparable value of a cell's visible text. */
export function sortKey(text: string): SortKey {
  const t = text.replace(/\s+/g, ' ').trim();
  if (EMPTY.test(t)) return { kind: 3 };
  if (ISO_DATE.test(t) || MONTH.test(t)) {
    const ms = Date.parse(t.replace(/\bsept\b/i, 'Sep').replace(/(\d)(st|nd|rd|th)\b/, '$1').replace(/ at /i, ' ').replace(/·/g, ' '));
    if (Number.isFinite(ms)) return { kind: 0, value: ms };
  }
  const n = NUMBER.exec(t);
  if (n) return { kind: 1, value: Number(n[0].replace(/,/g, '')) };
  return { kind: 2, value: t.toLocaleLowerCase() };
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;

/** Compare two keys in `direction`; empties last either way. */
export function compareKeys(a: SortKey, b: SortKey, direction: SortDirection): number {
  if (a.kind === 3 || b.kind === 3) return a.kind === b.kind ? 0 : a.kind === 3 ? 1 : -1;
  const sign = direction === 'ascending' ? 1 : -1;
  // Mixed kinds in one column (a date beside a word): group by kind.
  if (a.kind !== b.kind) return (a.kind - b.kind) * sign;
  if (a.kind === 2 && b.kind === 2) return (collator ? collator.compare(a.value, b.value) : a.value.localeCompare(b.value)) * sign;
  return ((a as { value: number }).value - (b as { value: number }).value) * sign;
}

/** The next state of a header click: ascending → descending → off. */
export function nextDirection(current: SortDirection | null): SortDirection | null {
  if (current === null) return 'ascending';
  if (current === 'ascending') return 'descending';
  return null;
}

/** Sort `items` by the text `textOf` gives, stably. */
export function sortByText<T>(items: readonly T[], textOf: (item: T) => string, direction: SortDirection): T[] {
  return items
    .map((item, index) => ({ item, index, key: sortKey(textOf(item)) }))
    .sort((a, b) => compareKeys(a.key, b.key, direction) || a.index - b.index)
    .map(entry => entry.item);
}
