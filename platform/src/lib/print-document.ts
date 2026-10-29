import { escapeHtml, openIsolatedHtmlWindow } from './safe-html';
import { formatPrintedAt, getPrintIdentity, pageFooterCss } from './print-identity';

/** Kept for callers that imported it from here. */
export { setPrintIdentity } from './print-identity';

export interface PrintDocumentMeta {
  label: string;
  value?: string | number | null;
}

export interface PrintDocumentOptions {
  title: string;
  documentLabel: string;
  facilityName?: string;
  /** Heading over the meta grid, e.g. "Patient Information". */
  metaTitle?: string;
  meta?: PrintDocumentMeta[];
  /** HTML assembled only from trusted markup and escapeHtml-encoded values. */
  safeBodyHtml: string;
  /** A closing line under the body (disclaimer); omitted when not given. */
  footer?: string;
  /** The document's own date, shown under its label (YYYY-MM-DD). */
  date?: string;
  /** Who printed it — "Printed by: …" in the page footer. */
  printedBy?: string;
  /** The printing account's username — "System ID: …" in the page footer. */
  systemId?: string;
  page?: 'a4' | 'a4-landscape' | 'receipt';
}

/**
 * TamamHealth's paper, in the OpenMRS O3 print shape (the O3 Visit Summary):
 * the facility mark and name on the left and the document's label and date on
 * the right over a hairline; bold sentence-case section titles, each on its
 * own hairline; small grey labels over bold values; tables with a light grey
 * head row and hairline rows. Every page carries the same footer in its
 * margin: facility and "Printed by" at the left, the print time in the middle,
 * "Page n of N" and "System ID" at the right. Monochrome and
 * photocopier-safe — no fills beyond the grey head rows.
 */
export const CLINICAL_PRINT_CSS = `
  :root { --ink:#001D3F; --muted:#3C5574; --line:#CFD6DD; --hair:#E2E6EB; --wash:#F1F3F5; --danger:#9E1B14; --success:#0A6E4A; }
  * { box-sizing:border-box; }
  html { background:#fff; }
  body { margin:0 auto; color:var(--ink); background:#fff; font:9.5pt/1.45 "IBM Plex Sans", Arial, Helvetica, sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .doc-head { display:flex; justify-content:space-between; align-items:center; gap:10mm; padding-bottom:4mm; border-bottom:.75pt solid var(--line); break-inside:avoid; }
  .doc-brand { display:flex; align-items:center; gap:5mm; }
  .doc-logo { width:13mm; height:13mm; object-fit:contain; }
  .doc-facility { margin:0; font-size:14pt; font-weight:700; line-height:1.2; }
  .doc-identity { text-align:right; }
  .doc-title { margin:0; font-size:12pt; font-weight:700; }
  .doc-label { margin:.5mm 0 0; font-size:8pt; color:var(--muted); }
  .doc-date { margin:.8mm 0 0; font-size:9pt; font-variant-numeric:tabular-nums; }
  .doc-meta-block { margin-top:5mm; break-inside:avoid; }
  .doc-meta { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:2.5mm 6mm; margin:0; padding:1mm 1mm 0; }
  .field-label { display:block; color:var(--muted); font-size:7.5pt; font-weight:400; margin-bottom:.3mm; }
  .field-value { display:block; color:var(--ink); font-weight:700; font-size:9.5pt; overflow-wrap:anywhere; }
  .doc-body { margin-top:5mm; }
  .section { margin:0 0 5mm; }
  .section-title, .doc-meta-title { margin:0 0 2mm; padding-bottom:1.2mm; font-size:11pt; font-weight:700; color:var(--ink); border-bottom:.75pt solid var(--line); break-after:avoid; letter-spacing:0; text-transform:none; }
  .section-title small { float:right; color:var(--muted); font-size:7.5pt; font-weight:400; }
  p { margin:0 0 2.5mm; }
  ul { margin:0; padding-left:5mm; }
  li { margin:0 0 1.2mm; }
  table { width:100%; border-collapse:collapse; font-size:9pt; margin:0 0 4mm; }
  thead { display:table-header-group; }
  tfoot { display:table-footer-group; }
  th { padding:1.8mm 2mm; text-align:left; font-size:7.5pt; font-weight:700; color:var(--muted); background:var(--wash); border-bottom:.75pt solid var(--line); letter-spacing:0; text-transform:none; }
  td { padding:1.8mm 2mm; vertical-align:top; border-bottom:.5pt solid var(--hair); overflow-wrap:anywhere; }
  tr { break-inside:avoid; }
  tr.group td { background:var(--wash); font-weight:700; }
  td.indent { padding-left:6mm; }
  .num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .center { text-align:center; }
  .muted { color:var(--muted); }
  .empty { padding:2mm 2mm; color:var(--muted); background:#fff; border:.5pt dashed var(--line); }
  .status { display:inline-block; padding:.4mm 1.8mm; border:.75pt solid var(--line); border-radius:1mm; font-size:7pt; font-weight:700; }
  .status-paid { color:var(--success); border-color:var(--success); }
  .status-alert { color:var(--danger); border-color:var(--danger); }
  .notice { margin:0 0 4mm; padding:2.5mm 3.5mm; border:.75pt solid var(--line); border-left:2.5pt solid var(--ink); break-inside:avoid; }
  .totals { width:min(78mm,100%); margin:4mm 0 0 auto; break-inside:avoid; }
  .total-row { display:flex; justify-content:space-between; gap:8mm; padding:1.2mm 0; border-bottom:.5pt solid var(--hair); }
  .total-row strong:last-child,.total-row span:last-child { text-align:right; font-variant-numeric:tabular-nums; }
  .total-row.grand { margin-top:1mm; padding-top:2mm; border-top:1pt solid var(--ink); border-bottom:0; font-size:11pt; }
  .signatures { display:grid; grid-template-columns:1fr 1fr; gap:15mm; margin-top:12mm; break-inside:avoid; }
  .signature { padding-top:9mm; border-bottom:.75pt solid var(--ink); }
  .signature-label { margin-top:1mm; color:var(--muted); font-size:7.5pt; }
  .note { margin:0 0 3mm; break-inside:avoid; }
  .note-meta { color:var(--muted); font-size:7.5pt; }
  .doc-closing { margin-top:6mm; color:var(--muted); font-size:7.5pt; }
  .doc-footer-screen { display:grid; grid-template-columns:1fr auto 1fr; gap:6mm; margin-top:10mm; padding-top:2.5mm; border-top:.5pt solid var(--line); color:var(--muted); font-size:7pt; }
  .doc-footer-screen span:last-child { text-align:right; }
  .keep { break-inside:avoid; }
  .page-break { break-before:page; }
  @media print { body { padding:0 !important; } .doc-footer-screen { display:none; } }
`;

function pageCss(page: NonNullable<PrintDocumentOptions['page']>): string {
  if (page === 'receipt') return `@page { size:80mm auto; margin:5mm; }
    body { width:70mm; font-size:8.5pt; }
    .doc-accent { margin-bottom:3mm; height:2mm; }
    .doc-head { display:block; padding-bottom:3mm; }
    .doc-facility { font-size:12pt; }
    .doc-identity { margin-top:3mm; text-align:left; }
    .doc-title { font-size:11pt; }
    .doc-meta { grid-template-columns:1fr 1fr; gap:2mm 4mm; margin-top:3mm; padding:2.5mm 3mm; }
    .doc-body { margin-top:4mm; }
    table { font-size:8pt; }
    .doc-footer { display:block; margin-top:6mm; }
    .doc-footer span:last-child { display:block; margin-top:1mm; }`;
  if (page === 'a4-landscape') return '@page { size:A4 landscape; margin:12mm; }';
  return '@page { size:A4 portrait; margin:14mm; }';
}

export function buildClinicalPrintDocument(options: PrintDocumentOptions): string {
  const facility = options.facilityName?.trim() || 'TamamHealth Health Facility';
  const meta = (options.meta || [])
    .filter(item => item.value !== undefined && item.value !== null && String(item.value).trim() !== '')
    .map(item => `<div><span class="field-label">${escapeHtml(item.label)}</span><span class="field-value">${escapeHtml(item.value)}</span></div>`)
    .join('');
  const page = options.page || 'a4';
  const printedAtDate = new Date();
  const printedAt = formatPrintedAt(printedAtDate);
  const who = getPrintIdentity();
  const printedBy = options.printedBy || who?.name || '';
  const systemId = options.systemId || who?.username || '';
  const right = systemId ? `System ID: ${systemId}` : '';
  // Margin boxes carry the footer on every printed page (Chromium 131+, the
  // browser the clinics run). The on-screen preview shows the same line once.
  const footerCss = page === 'receipt' ? '' : pageFooterCss({ facilityName: facility, printedBy, systemId, printedAt: printedAtDate });
  const logo = typeof window !== 'undefined' ? `${window.location.origin}/assets/tamam-icon.svg` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.documentLabel)} — ${escapeHtml(options.title)}</title>
<style>${pageCss(page)}${footerCss}${CLINICAL_PRINT_CSS}</style></head>
<body>
  <header class="doc-head">
    <div class="doc-brand">${logo ? `<img class="doc-logo" src="${escapeHtml(logo)}" alt="">` : ''}<h1 class="doc-facility">${escapeHtml(facility)}</h1></div>
    <div class="doc-identity"><h2 class="doc-title">${escapeHtml(options.title)}</h2>${options.documentLabel && options.documentLabel !== options.title ? `<p class="doc-label">${escapeHtml(options.documentLabel)}</p>` : ''}${options.date ? `<p class="doc-date">${escapeHtml(options.date)}</p>` : ''}</div>
  </header>
  ${meta ? `<section class="doc-meta-block">${options.metaTitle ? `<h2 class="doc-meta-title">${escapeHtml(options.metaTitle)}</h2>` : ''}<div class="doc-meta">${meta}</div></section>` : ''}
  <main class="doc-body">${options.safeBodyHtml}</main>
  ${options.footer?.trim() ? `<p class="doc-closing">${escapeHtml(options.footer.trim())}</p>` : ''}
  <footer class="doc-footer-screen"><span>${escapeHtml(facility)}${printedBy ? `<br>Printed by: ${escapeHtml(printedBy)}` : ''}</span><span>${escapeHtml(printedAt)}</span><span>${right ? escapeHtml(right) : ''}</span></footer>
</body></html>`;
}

export function printClinicalDocument(options: PrintDocumentOptions): void {
  openIsolatedHtmlWindow(buildClinicalPrintDocument(options), '', true);
}
