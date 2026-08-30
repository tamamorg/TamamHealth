/**
 * Encode an untrusted value as a spreadsheet-safe CSV cell.
 *
 * RFC 4180 quoting prevents broken columns, but it does not stop Excel and
 * similar applications from interpreting cells beginning with =, +, -, or @
 * as formulas. Prefixing those values with an apostrophe makes the cell text
 * in spreadsheet applications while preserving the original visible value.
 */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function rowsToCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(row => row.map(escapeCsvCell).join(',')),
  ].join('\n');
}
