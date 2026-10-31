import { getPrintIdentity, pageFooterCss, printDate } from './print-identity';

/**
 * Encode an arbitrary value for an HTML text node.
 *
 * Printable documents are assembled as strings rather than rendered by React,
 * so React's normal output encoding does not protect them. Keep this helper
 * deliberately small and context-specific: it is for text nodes and quoted
 * attribute values, never for CSS or JavaScript contexts.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Open a generated printable document after severing its opener reference.
 * All dynamic values in `html` must still be passed through `escapeHtml`.
 */
export function openIsolatedHtmlWindow(html: string, features = '', autoPrint = false): void {
  if (autoPrint) {
    // Print from a script-free iframe. Strict CSP blocks scripts embedded in
    // generated blob documents, and blob-policy inheritance differs between
    // browsers. The trusted application document invokes print instead.
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.inset = '0';
    frame.onload = () => {
      const printable = frame.contentWindow;
      if (!printable) return;
      printable.focus();
      printable.print();
      printable.addEventListener('afterprint', () => frame.remove(), { once: true });
      setTimeout(() => frame.remove(), 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
    return;
  }
  const featureList = ['noopener', 'noreferrer', features].filter(Boolean).join(',');
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  // Blob documents have an opaque origin; noopener also severs the navigation
  // relationship. Do not depend on the return value: browsers commonly return
  // null precisely because noopener isolation succeeded.
  window.open(url, '_blank', featureList);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export interface PrintHeading {
  /** What the document is ("Lab Report"), at the top right of the sheet. */
  label: string;
  /** Its own date; today when not given. */
  date?: string | Date;
  /** Heading over `fields`, e.g. "Patient Information". */
  fieldsTitle?: string;
  /** Who the sheet is about, under the heading; empty values are left out. */
  fields?: { label: string; value?: string | number | null }[];
}

/** The sheet's heading for a document printed from the screen: the facility at
 *  the left, the document and its date at the right, as on a generated one. */
function printHeadingElement({ label, date, fieldsTitle, fields = [] }: PrintHeading): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'print-doc-top';
  const head = document.createElement('header');
  head.className = 'print-doc-head';
  const brand = document.createElement('div');
  brand.className = 'print-doc-brand';
  const logo = document.createElement('img');
  logo.src = '/assets/tamam-icon.svg';
  logo.alt = '';
  const facility = document.createElement('strong');
  facility.textContent = getPrintIdentity()?.facilityName || 'TamamHealth Health Facility';
  brand.append(logo, facility);
  const identity = document.createElement('div');
  identity.className = 'print-doc-identity';
  const title = document.createElement('strong');
  title.textContent = label;
  const day = document.createElement('span');
  day.textContent = printDate(date) || printDate(new Date());
  identity.append(title, day);
  head.append(brand, identity);
  wrap.append(head);
  const shown = fields.filter(f => f.value !== undefined && f.value !== null && String(f.value).trim() !== '');
  if (shown.length) {
    const block = document.createElement('section');
    block.className = 'print-doc-fields';
    if (fieldsTitle) {
      const title = document.createElement('h2');
      title.textContent = fieldsTitle;
      block.append(title);
    }
    const grid = document.createElement('div');
    for (const field of shown) {
      const cell = document.createElement('div');
      const name = document.createElement('span');
      name.textContent = field.label;
      const value = document.createElement('strong');
      value.textContent = String(field.value);
      cell.append(name, value);
      grid.append(cell);
    }
    block.append(grid);
    wrap.append(block);
  }
  return wrap;
}

/**
 * Print one already-rendered clinical document without leaking the surrounding
 * dashboard, modal backdrop, or a second hidden print target onto paper.
 */
export function printElementById(id: string, document_?: PrintHeading): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.setAttribute('data-print-active', 'true');
  // The same page footer every generated printout carries (facility, printed
  // by, time, page n of N, system ID), added for this print only.
  const footer = document.createElement('style');
  footer.setAttribute('data-print-footer', '');
  footer.textContent = pageFooterCss();
  document.head.appendChild(footer);
  const heading = document_ ? printHeadingElement(document_) : null;
  if (heading) target.prepend(heading);
  const cleanup = () => { target.removeAttribute('data-print-active'); footer.remove(); heading?.remove(); };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 60_000);
  return true;
}

/**
 * window.print() with the shared page footer (facility, printed by, time,
 * page n of N, system ID) added for that print only — for documents that
 * print themselves rather than through printElementById.
 */
export function printWithFooter(): void {
  const footer = document.createElement('style');
  footer.setAttribute('data-print-footer', '');
  footer.textContent = pageFooterCss();
  document.head.appendChild(footer);
  const cleanup = () => footer.remove();
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 60_000);
}
