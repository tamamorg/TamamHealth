'use client';

/**
 * Browser file downloads — CSV serialisation and the blob/anchor dance.
 *
 * Four national-reporting pages wrote their own copy of this: `/reports`,
 * `/immunizations`, `/dhis2-export` and `/surveillance`. The download step
 * (blob → object URL → anchor → click → revoke) was identical in all four; the
 * CSV serialisation was duplicated in two, character for character.
 *
 * Consolidating them fixes something none of them got right.
 *
 * ## Excel and the byte-order mark
 *
 * Excel on Windows does not detect UTF-8 in a `.csv`. Without a leading BOM it
 * decodes the file as the system's legacy codepage, and every non-ASCII
 * character arrives mangled. That is not an edge case here: the registers are
 * full of South Sudanese names, and the platform ships a Juba Arabic locale, so
 * a ministry officer opening an exported immunisation register sees mojibake
 * where the child's name should be. Two of the four callers set
 * `charset=utf-8` on the MIME type — which addresses a completely different
 * layer and does nothing for Excel — and none emitted a BOM.
 *
 * So `downloadCsv` prepends one by default, and `bom: false` is available for
 * the case where it is wrong: a machine-read payload. A strict CSV parser on
 * the far end of a DHIS2 import treats the BOM as part of the first column
 * name, so that caller opts out.
 */

/** U+FEFF. What tells Excel the bytes that follow are UTF-8. */
const UTF8_BOM = '﻿';

/**
 * A cell value.
 *
 * Deliberately `unknown` rather than a primitive union: `/reports` assembles
 * rows out of report data typed as `unknown`, and every hand-rolled copy this
 * replaces did `String(value ?? '')`. Narrowing here would force a cast at each
 * call site without making anything safer — the values are primitives at
 * runtime. Anything that is not stringifies the way `String()` renders it, so
 * an object arrives as `[object Object]` exactly as it did before.
 */
export type CsvCell = unknown;

/**
 * Quote one cell.
 *
 * Everything is quoted rather than only the cells that need it. Conditional
 * quoting means deciding what "needs" it — commas, quotes, newlines, a leading
 * or trailing space, a value a spreadsheet would coerce to a date — and each of
 * the hand-rolled copies had a slightly different idea. Quoting unconditionally
 * is one rule, and it is what both existing CSV writers already did.
 */
function quote(cell: CsvCell): string {
  return `"${String(cell ?? '').replace(/"/g, '""')}"`;
}

/**
 * Serialise rows to CSV text.
 *
 * `headers` may be given explicitly (the caller controls column order and
 * labels) or derived from the first row's keys, which is what `/reports` did.
 * Deriving is only safe when every row has the same shape, so an explicit list
 * is preferred for anything assembled from mixed sources.
 */
export function toCsv(
  rows: Record<string, CsvCell>[],
  headers?: string[],
): string {
  if (rows.length === 0) return '';
  const cols = headers ?? Object.keys(rows[0]);
  return [
    cols.map(quote).join(','),
    ...rows.map(row => cols.map(col => quote(row[col])).join(',')),
  ].join('\n');
}

/** Serialise a header row plus positional rows, for callers that build arrays. */
export function toCsvRows(header: CsvCell[], rows: CsvCell[][]): string {
  return [header, ...rows].map(row => row.map(quote).join(',')).join('\n');
}

/**
 * Hand a string to the browser as a downloaded file.
 *
 * The object URL is revoked on the next macrotask rather than immediately after
 * `click()`. Safari has not always started reading the blob by the time the
 * synchronous call returns, and revoking first produces a download that fails
 * with no error — the shape of bug that gets reported as "the button does
 * nothing sometimes" and is close to unreproducible on a developer's Mac.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface DownloadCsvOptions {
  /** Column order/labels. Derived from the first row when omitted. */
  headers?: string[];
  /**
   * Prepend the UTF-8 BOM. On by default so Excel reads names correctly; turn
   * it off for a payload another system parses.
   */
  bom?: boolean;
}

/**
 * Download rows as a `.csv`.
 *
 * Returns false when there is nothing to write, so a caller can tell the user
 * rather than appearing to do nothing — each hand-rolled copy returned silently
 * on an empty list, which is indistinguishable from a broken button.
 */
export function downloadCsv(
  rows: Record<string, CsvCell>[],
  filename: string,
  options: DownloadCsvOptions = {},
): boolean {
  if (rows.length === 0) return false;
  const csv = toCsv(rows, options.headers);
  downloadCsvText(csv, filename, options.bom);
  return true;
}

/** Download already-serialised CSV text. For callers that build their own. */
export function downloadCsvText(csv: string, filename: string, bom = true): void {
  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  downloadFile((bom ? UTF8_BOM : '') + csv, name, 'text/csv;charset=utf-8');
}

/** Download a value as pretty-printed JSON. No BOM — it is a machine payload. */
export function downloadJson(value: unknown, filename: string): void {
  const name = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;
  downloadFile(JSON.stringify(value, null, 2), name, 'application/json');
}

/**
 * Make a string safe to sit inside a filename.
 *
 * The callers build names out of live values — a reporting week, a vaccine
 * name, a period — and each sanitised differently or not at all. A `/` in a
 * vaccine name silently truncates the download to the segment after it.
 */
export function safeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}
