'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import { Printer, Download } from '@/components/icons/lucide';
import { escapeHtml } from '@/lib/safe-html';

/** One column of a printable list. `key` indexes into each row record. */
export interface PrintListColumn {
  key: string;
  label: string;
}

/** One selectable list (a lane, a board, a register) offered by the dialog. */
export interface PrintListSection {
  key: string;
  label: string;
  columns: PrintListColumn[];
  /** Already-formatted plain strings — the print output adds no styling of
   *  its own beyond a bare table, so cells carry their final text. */
  rows: Array<Record<string, string>>;
}

type OutputFormat = 'print' | 'csv';

/**
 * The printed page is a standalone document written into a hidden iframe —
 * not the app under `@media print`. That is what makes it a "pure list":
 * none of the dashboard chrome, card styling, or globals.css print traps
 * apply, just a black-on-white table per section.
 */
function buildPrintHtml(title: string, subtitle: string | undefined, sections: PrintListSection[]): string {
  const printedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const meta = [subtitle, `Printed ${printedAt}`].filter(Boolean).map(part => escapeHtml(String(part))).join(' · ');
  const body = sections.map(section => {
    const heading = sections.length > 1 ? `<h2>${escapeHtml(section.label)}</h2>` : '';
    if (section.rows.length === 0) return `${heading}<p class="empty">No entries.</p>`;
    const head = section.columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
    const rows = section.rows.map(row =>
      `<tr>${section.columns.map(column => `<td>${escapeHtml(row[column.key] ?? '')}</td>`).join('')}</tr>`,
    ).join('');
    return `${heading}<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 1.2cm; }
  body { margin: 0; font: 12px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #000; background: #fff; }
  h1 { font-size: 16px; margin: 0; }
  .meta { margin: 2px 0 0; font-size: 11px; color: #333; }
  h2 { font-size: 13px; margin: 16px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; vertical-align: top; padding: 4px 10px 4px 0; border-bottom: 1px solid #999; }
  th { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; border-bottom-color: #000; }
  tr { break-inside: avoid; }
  .empty { margin: 8px 0 0; color: #333; font-style: italic; }
</style></head>
<body><h1>${escapeHtml(title)}</h1><p class="meta">${meta}</p>${body}</body></html>`;
}

function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => frame.remove();
  win.addEventListener('afterprint', cleanup);
  // A paint tick before print so the document is laid out; the timeout is a
  // fallback for browsers that never fire afterprint on iframes.
  setTimeout(() => { win.focus(); win.print(); }, 50);
  setTimeout(cleanup, 60_000);
}

function downloadCsv(filename: string, sections: PrintListSection[]) {
  const quote = (cell: string) => `"${String(cell).replace(/"/g, '""')}"`;
  // Sections can carry different column sets, so each becomes its own block
  // (label line, header, rows) rather than being forced into one grid.
  const blocks = sections.map(section => {
    const lines = [
      ...(sections.length > 1 ? [quote(section.label)] : []),
      section.columns.map(column => quote(column.label)).join(','),
      ...section.rows.map(row => section.columns.map(column => quote(row[column.key] ?? '')).join(',')),
    ];
    return lines.join('\n');
  });
  const url = URL.createObjectURL(new Blob([blocks.join('\n\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * "Print" as a choice, not an ambush: pick which lists go out, then pick the
 * output — the printer (where the browser dialog also offers "Save as PDF")
 * or a CSV download for spreadsheets. Both outputs are the same pure list.
 */
export default function PrintListDialog({ title, subtitle, sections, filename, onClose }: {
  title: string;
  subtitle?: string;
  sections: PrintListSection[];
  /** Base name (no extension) for the CSV download. */
  filename: string;
  onClose: () => void;
}) {
  // Preselect the sections that have rows — printing every empty lane by
  // default is noise, but any can be ticked back on.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const withRows = sections.filter(section => section.rows.length > 0).map(section => section.key);
    return new Set(withRows.length > 0 ? withRows : sections.map(section => section.key));
  });
  const [format, setFormat] = useState<OutputFormat>('print');

  const toggle = (key: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const chosen = sections.filter(section => selected.has(section.key));
  const run = () => {
    if (chosen.length === 0) return;
    if (format === 'print') printHtml(buildPrintHtml(title, subtitle, chosen));
    else downloadCsv(filename, chosen);
    onClose();
  };

  // globals.css force-uppercases every <label>; these are sentence-case
  // choices, so each label resets that inline.
  const choiceLabel: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 10, margin: 0, padding: '9px 12px',
    border: '1px solid var(--border-light)', borderRadius: 10, cursor: 'pointer',
    textTransform: 'none', letterSpacing: 'normal', fontWeight: 500, fontSize: 13,
    color: 'var(--text-primary)',
  };
  const groupHead: React.CSSProperties = {
    margin: '0 0 8px', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: 'var(--text-muted)',
  };

  return (
    <Modal onClose={onClose} width={440} labelledBy="print-list-title">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h3 id="print-list-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          {subtitle && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>

        <div>
          <p style={groupHead}>What to print</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sections.map(section => (
              <label key={section.key} style={choiceLabel}>
                <input
                  type="checkbox"
                  checked={selected.has(section.key)}
                  onChange={() => toggle(section.key)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ flex: 1 }}>{section.label}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                  {section.rows.length === 1 ? '1 row' : `${section.rows.length} rows`}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p style={groupHead}>Format</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={choiceLabel}>
              <input
                type="radio"
                name="print-list-format"
                checked={format === 'print'}
                onChange={() => setFormat('print')}
                style={{ marginTop: 2 }}
              />
              <span style={{ flex: 1 }}>
                <strong style={{ display: 'block', fontWeight: 600 }}>Print</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Plain list to paper — or choose &ldquo;Save as PDF&rdquo; in the print dialog to download it.
                </span>
              </span>
              <Printer className="w-4 h-4" style={{ marginTop: 2, color: 'var(--text-muted)' }} />
            </label>
            <label style={choiceLabel}>
              <input
                type="radio"
                name="print-list-format"
                checked={format === 'csv'}
                onChange={() => setFormat('csv')}
                style={{ marginTop: 2 }}
              />
              <span style={{ flex: 1 }}>
                <strong style={{ display: 'block', fontWeight: 600 }}>Download CSV</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Spreadsheet file for Excel or Google Sheets.
                </span>
              </span>
              <Download className="w-4 h-4" style={{ marginTop: 2, color: 'var(--text-muted)' }} />
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={chosen.length === 0}>
            {format === 'print' ? 'Print' : 'Download CSV'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
