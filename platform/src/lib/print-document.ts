import { escapeHtml, openIsolatedHtmlWindow } from './safe-html';

export interface PrintDocumentMeta {
  label: string;
  value?: string | number | null;
}

export interface PrintDocumentOptions {
  title: string;
  documentLabel: string;
  facilityName?: string;
  meta?: PrintDocumentMeta[];
  /** HTML assembled only from trusted markup and escapeHtml-encoded values. */
  safeBodyHtml: string;
  footer?: string;
  page?: 'a4' | 'a4-landscape' | 'receipt';
}

/**
 * TamamHealth's paper language: a quiet clinical ledger rather than a screen
 * screenshot. The split navy/orange rule is the sole brand gesture; everything
 * below it is monochrome, compact, and photocopier-safe.
 */
export const CLINICAL_PRINT_CSS = `
  :root { --ink:#001D3F; --navy:#113055; --muted:#5D728B; --line:#CFD6DD; --wash:#F5F7F8; --blue:#015697; --orange:#FF7F00; --danger:#9E1B14; --success:#0A6E4A; }
  * { box-sizing:border-box; }
  html { background:#fff; }
  body { margin:0 auto; color:var(--ink); background:#fff; font:10pt/1.45 Arial, Helvetica, sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .doc-accent { display:grid; grid-template-columns:minmax(0, 5fr) minmax(34mm, 1fr); height:3mm; margin-bottom:6mm; }
  .doc-accent span:first-child { background:var(--navy); }
  .doc-accent span:last-child { background:var(--orange); }
  .doc-head { display:grid; grid-template-columns:minmax(0, 1fr) minmax(48mm, auto); gap:10mm; align-items:start; padding-bottom:5mm; border-bottom:1.5pt solid var(--navy); break-inside:avoid; }
  .doc-brand-kicker,.doc-label,.section-title,.field-label,th { font-size:7.5pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .doc-brand-kicker { color:var(--blue); }
  .doc-facility { margin:1mm 0 0; font-size:16pt; line-height:1.1; color:var(--navy); }
  .doc-subbrand { margin:1.5mm 0 0; color:var(--muted); font-size:8pt; }
  .doc-identity { text-align:right; }
  .doc-label { color:var(--blue); }
  .doc-title { margin:1mm 0 0; font-size:15pt; line-height:1.15; color:var(--navy); }
  .doc-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(32mm,1fr)); gap:2.5mm 7mm; margin:5mm 0 0; padding:3.5mm 4mm; background:var(--wash); border-left:2.5pt solid var(--blue); break-inside:avoid; }
  .field-label { display:block; color:var(--muted); margin-bottom:.5mm; }
  .field-value { display:block; color:var(--ink); font-weight:600; overflow-wrap:anywhere; }
  .doc-body { margin-top:6mm; }
  .section { margin:0 0 6mm; }
  .section-title { margin:0 0 2.5mm; padding-bottom:1.5mm; color:var(--navy); border-bottom:1pt solid var(--navy); break-after:avoid; }
  .section-title small { float:right; color:var(--muted); font-size:7pt; letter-spacing:0; text-transform:none; }
  p { margin:0 0 3mm; }
  ul { margin:0; padding-left:5mm; }
  li { margin:0 0 1.5mm; }
  table { width:100%; border-collapse:collapse; font-size:8.5pt; margin:0 0 5mm; }
  thead { display:table-header-group; }
  tfoot { display:table-footer-group; }
  th { padding:2.2mm 2mm; text-align:left; color:var(--navy); background:var(--wash); border-top:1pt solid var(--navy); border-bottom:1pt solid var(--navy); }
  td { padding:2.2mm 2mm; vertical-align:top; border-bottom:.5pt solid var(--line); overflow-wrap:anywhere; }
  tr { break-inside:avoid; }
  .num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .center { text-align:center; }
  .muted { color:var(--muted); }
  .empty { padding:5mm 2mm; text-align:center; color:var(--muted); font-style:italic; }
  .status { display:inline-block; padding:.6mm 2mm; border:1pt solid var(--line); border-radius:2mm; font-size:7pt; font-weight:700; text-transform:uppercase; }
  .status-paid { color:var(--success); border-color:var(--success); }
  .status-alert { color:var(--danger); border-color:var(--danger); }
  .notice { margin:0 0 5mm; padding:3mm 4mm; border:1pt solid var(--line); border-left:3pt solid var(--orange); background:#fff; break-inside:avoid; }
  .totals { width:min(78mm,100%); margin:5mm 0 0 auto; break-inside:avoid; }
  .total-row { display:flex; justify-content:space-between; gap:8mm; padding:1.5mm 0; border-bottom:.5pt solid var(--line); }
  .total-row strong:last-child,.total-row span:last-child { text-align:right; font-variant-numeric:tabular-nums; }
  .total-row.grand { margin-top:1mm; padding-top:2.5mm; border-top:1.5pt solid var(--navy); border-bottom:0; color:var(--navy); font-size:12pt; }
  .signatures { display:grid; grid-template-columns:1fr 1fr; gap:15mm; margin-top:12mm; break-inside:avoid; }
  .signature { padding-top:9mm; border-bottom:1pt solid var(--navy); }
  .signature-label { margin-top:1mm; color:var(--muted); font-size:7.5pt; }
  .doc-footer { display:flex; justify-content:space-between; gap:10mm; margin-top:10mm; padding-top:3mm; border-top:1pt solid var(--line); color:var(--muted); font-size:7pt; }
  .keep { break-inside:avoid; }
  .page-break { break-before:page; }
  @media print { body { padding:0 !important; } }
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
  const footer = options.footer?.trim() || 'Electronically generated clinical document · Verify against the source record when making care decisions.';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.documentLabel)} — ${escapeHtml(options.title)}</title>
<style>${pageCss(options.page || 'a4')}${CLINICAL_PRINT_CSS}</style></head>
<body>
  <div class="doc-accent" aria-hidden="true"><span></span><span></span></div>
  <header class="doc-head">
    <div><div class="doc-brand-kicker">TamamHealth clinical record</div><h1 class="doc-facility">${escapeHtml(facility)}</h1><p class="doc-subbrand">Digital health records for safer continuity of care</p></div>
    <div class="doc-identity"><div class="doc-label">${escapeHtml(options.documentLabel)}</div><h2 class="doc-title">${escapeHtml(options.title)}</h2></div>
  </header>
  ${meta ? `<section class="doc-meta">${meta}</section>` : ''}
  <main class="doc-body">${options.safeBodyHtml}</main>
  <footer class="doc-footer"><span>${escapeHtml(footer)}</span><span>Powered by TamamHealth</span></footer>
</body></html>`;
}

export function printClinicalDocument(options: PrintDocumentOptions): void {
  openIsolatedHtmlWindow(buildClinicalPrintDocument(options), '', true);
}
