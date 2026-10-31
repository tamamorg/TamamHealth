/**
 * Who is printing, and where — read by every printout's page footer
 * ("Facility · Printed by · time · Page n of N · System ID"). The auth context
 * sets it when the session loads (lib/context.tsx), so no print surface has to
 * thread the signed-in user through to the document it prints.
 */
export interface PrintIdentity {
  name?: string;
  username?: string;
  facilityName?: string;
}

let identity: PrintIdentity | null = null;

export function setPrintIdentity(next: PrintIdentity | null): void {
  identity = next;
}

export function getPrintIdentity(): PrintIdentity | null {
  return identity;
}

/** A value for a CSS `content:` string: quotes and backslashes escaped, line
 *  breaks as \A (the margin boxes use white-space: pre), and `<` as a CSS
 *  escape so a value cannot close the <style> element it is written into. */
export function cssContentString(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ').replace(/</g, '\\3C ') + '"';
}

/** "2026-10-28 23:32:11" — the print time, local wall clock. */
export function formatPrintedAt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "2026-10-28" — the date form on every printout. A date-only value is that
 *  calendar day as stored; `new Date()` would read it as UTC midnight. */
export function printDate(value?: string | Date | null): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : formatPrintedAt(d).slice(0, 10);
}

/** The page-footer margin boxes every printout carries. */
export function pageFooterCss(opts: { facilityName?: string; printedBy?: string; systemId?: string; printedAt?: Date } = {}): string {
  const who = getPrintIdentity();
  const facility = opts.facilityName || who?.facilityName || '';
  const printedBy = opts.printedBy || who?.name || '';
  const systemId = opts.systemId || who?.username || '';
  const left = [facility, printedBy ? `Printed by: ${printedBy}` : ''].filter(Boolean).join('\n');
  const at = formatPrintedAt(opts.printedAt || new Date());
  const box = 'font: 7pt Arial, Helvetica, sans-serif; color: #3C5574; vertical-align: top; padding-top: 2mm; margin-top: 5mm; border-top: .5pt solid #CFD6DD;';
  return `@page {
      margin: 14mm 14mm 22mm;
      @bottom-left { content: ${cssContentString(left)}; white-space: pre; ${box} }
      @bottom-center { content: ${cssContentString(at)}; ${box} }
      @bottom-right { content: "Page " counter(page) " of " counter(pages)${systemId ? ` "\\A " ${cssContentString(`System ID: ${systemId}`)}` : ''}; white-space: pre; text-align: right; ${box} }
    }`;
}
