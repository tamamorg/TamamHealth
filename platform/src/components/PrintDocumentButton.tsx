'use client';

/**
 * PrintDocumentButton — "Print or save as PDF" for a legal document page.
 *
 * A bare `window.print()` is the wrong answer for the EHR's worklists, which
 * go through PrintListDialog so the reader can choose what lands on the page.
 * A legal document has no such choice to make: the page IS the document, and
 * the global print stylesheet already drops the header nav, the footer and
 * this button, so what prints is the text and nothing else.
 *
 * Client-only because it touches `window`; the page around it stays a server
 * component.
 */

import { Printer } from '@/components/icons/lucide';

export default function PrintDocumentButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <button type="button" className="lg-print-btn" onClick={() => window.print()}>
      <Printer size={14} aria-hidden /> {label}
    </button>
  );
}
