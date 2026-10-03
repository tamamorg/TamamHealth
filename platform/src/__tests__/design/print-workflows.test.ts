/**
 * @jest-environment node
 *
 * Paper output is a clinical artifact, not a screenshot of whichever modal is
 * open. These checks keep print actions scoped and generated documents safe.
 */
import fs from 'fs';
import path from 'path';
import { buildClinicalPrintDocument } from '@/lib/print-document';
import { buildReceiptData, generateReceiptHTML, type ReceiptData } from '@/lib/services/receipt-service';
import { buildPrintListHtml, printableTime, printListTitle } from '@/components/PrintListDialog';

const SRC = path.join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('clinical print document', () => {
  it('escapes document identity and metadata while retaining trusted body markup', () => {
    const html = buildClinicalPrintDocument({
      title: '<Patient & family>',
      documentLabel: 'Summary "draft"',
      facilityName: 'Juba <Hospital>',
      meta: [{ label: 'MRN', value: 'A&B' }],
      safeBodyHtml: '<section class="section">Trusted body</section>',
    });
    expect(html).toContain('&lt;Patient &amp; family&gt;');
    expect(html).toContain('Juba &lt;Hospital&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('<section class="section">Trusted body</section>');
    expect(html).toContain('@page { size:A4 portrait; margin:14mm; }');
    expect(html).toContain('thead { display:table-header-group; }');
  });

  it('lays receipts out for 80 mm paper and prints essential payment identity', () => {
    const receipt: ReceiptData = {
      receiptNumber: 'RCT-1007', patientName: 'Alek & Deng', patientId: 'JTH-77',
      date: 'August 31, 2026', time: '10:42 AM', method: 'cash', methodLabel: 'Cash',
      amount: 12500, currency: 'SSP', reference: 'CASH-42', processedBy: 'Amira Juma',
      facilityName: 'Juba Teaching Hospital', notes: 'Paid in full',
    };
    const html = generateReceiptHTML(receipt);
    expect(html).toContain('@page { size:80mm auto; margin:5mm; }');
    expect(html).toContain('RCT-1007');
    expect(html).toContain('JTH-77');
    expect(html).toContain('12,500');
    expect(html).toContain('CASH-42');
    expect(html).toContain('Alek &amp; Deng');
    expect(html).not.toContain('undefined');
  });
});

describe('receipt identity', () => {
  const payment = {
    _id: 'pay-1', patientId: 'pat-00001', patientName: 'Deng Garang', amount: 10500, currency: 'SSP',
    method: 'cash', reference: 'REC-13A87A53', processedAt: '2026-10-03T12:21:00.000Z', processedByName: 'Deng Akec Ring',
  } as never;

  it('prints the hospital number as the patient ID, not the internal record id', () => {
    const receipt = buildReceiptData(payment, 'Juba Teaching Hospital', 'JTH-000001');
    expect(receipt.patientId).toBe('JTH-000001');
    const html = generateReceiptHTML(receipt);
    expect(html).toContain('JTH-000001');
    expect(html).not.toContain('pat-00001');
  });

  it('falls back to the record id only when no hospital number is known', () => {
    expect(buildReceiptData(payment, 'Juba Teaching Hospital').patientId).toBe('pat-00001');
    expect(buildReceiptData(payment, 'Juba Teaching Hospital', '  ').patientId).toBe('pat-00001');
  });
});

describe('print actions are scoped', () => {
  it('allows bare window.print only in the print helper, legal page, and signed chart document', () => {
    const allowed = new Set([
      'lib/safe-html.ts',
      'components/PrintDocumentButton.tsx',
      'components/patients/PatientDetailPage.tsx',
    ]);
    const offenders = walk(SRC).flatMap(file => {
      const rel = path.relative(SRC, file);
      const source = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (rel.includes('__tests__') || !/window\.print\(\)/.test(source)) return [];
      return allowed.has(rel) ? [] : [rel];
    });
    expect(offenders).toEqual([]);
  });

  it.each([
    'components/PrintListDialog.tsx',
    'components/patients/BillingTab.tsx',
    'components/clinical-notes/CareCoordinationModal.tsx',
    'components/clinical-notes/prescribe/PrescribeModal.tsx',
    'components/ehr/EhrClinicalDashboard.tsx',
    'app/(dashboard)/billing/[id]/page.tsx',
    'app/(dashboard)/pharmacy/page.tsx',
    'lib/services/receipt-service.ts',
  ])('%s uses the shared standalone paper system', relative => {
    expect(fs.readFileSync(path.join(SRC, relative), 'utf8')).toContain('buildClinicalPrintDocument');
  });
});

/**
 * The in-page ("print this element") path. Every assertion here is a bug that
 * shipped: the rules passed review because they read correctly, and only a
 * real print showed a blank or one-page sheet. Verified in Chromium against
 * the running app; these keep the rules from drifting back.
 */
describe('targeted in-page printing', () => {
  const read = (relative: string) => fs.readFileSync(path.join(SRC, relative), 'utf8');
  const printBlock = (css: string) => css.slice(css.indexOf('/* ============ Print-Friendly Styles'), css.indexOf('/* ============ Toggle Switch'));

  it('shows the target with a selector that out-ranks the rule hiding everything', () => {
    const css = printBlock(read('app/globals.css'));
    expect(css).toContain('body:has([data-print-active]) * {');
    // `:has()` carries its argument's specificity, so the hide rule is (0,1,1).
    // A bare `[data-print-active] *` is (0,1,0): it loses, and the page prints blank.
    expect(css).toMatch(/body:has\(\[data-print-active\]\) \[data-print-active\],\s*body:has\(\[data-print-active\]\) \[data-print-active\] \* \{\s*visibility: visible !important;/);
    expect(css).not.toMatch(/^\s*\[data-print-active\],\s*\[data-print-active\] \* \{\s*visibility: visible/m);
  });

  it('takes the rest of the page out of the flow and releases the target\'s ancestors', () => {
    const css = printBlock(read('app/globals.css'));
    // Without these the document stays inside the app shell's clipped,
    // fixed-height frame and prints one page however long it is.
    expect(css).toContain('*:not(:has([data-print-active])):not([data-print-active]):not([data-print-active] *)');
    const release = css.slice(css.indexOf('html:has([data-print-active]),'));
    expect(release).toMatch(/overflow: visible !important;/);
    expect(release).toMatch(/height: auto !important;/);
    expect(release).toMatch(/position: static !important;/);
    expect(css).not.toMatch(/\[data-print-active\] \{[^}]*position: absolute/);
  });

  it('keeps route stylesheets from hiding the whole body on print', () => {
    // lab-order.css once did, and — a stylesheet stays loaded after its route
    // is visited — blanked every other print on the page it shared.
    const labOrder = read('components/lab/order/lab-order.css');
    const labPrint = labOrder.slice(labOrder.indexOf('@media print'));
    expect(labPrint).not.toMatch(/body \* \{\s*visibility: hidden/);
  });

  it('prints the signed chart record through a named page, released from the shell', () => {
    const chart = read('components/patients/PatientDetailPage.tsx');
    expect(chart).toContain('@page chart-record');
    expect(chart).toContain('page: chart-record;');
    // An unscoped zero margin applied to every print made from the chart.
    expect(chart).not.toMatch(/@page \{\s*size: A4;\s*margin: 0;/);
    expect(chart).toContain('body:has(.print-doc-root) *:not(:has(.print-doc-root)):not(.print-doc-root):not(.print-doc-root *)');
    expect(chart).not.toMatch(/body \* \{ visibility: hidden !important; \}/);
  });

  it('leaves the lab report printable for a read-only viewer', () => {
    // The panel disables its fieldset for viewers who cannot work the bench;
    // a disabled fieldset disables Print with it.
    const panel = read('components/lab/workflow/LabWorkflowPanel.tsx');
    expect(panel).toContain("disabled={!canWork && ctrl.step !== 'report'}");
    expect(panel).toContain('readOnly={!canWork}');
  });
});

describe('printed worklists', () => {
  const section = { key: 'waiting', label: 'Waiting', columns: [{ key: 'patient', label: 'Patient' }], rows: [{ patient: 'Anna <Bol>' }] };

  it('are headed with the facility and titled as the list, not the command', () => {
    const html = buildPrintListHtml('Print worklist', 'Saturday — Dr. Wani', [section], 'Juba Teaching Hospital');
    expect(html).toContain('Juba Teaching Hospital');
    expect(html).not.toContain('TamamHealth Health Facility');
    expect(html).toContain('<h2 class="doc-title">Worklist</h2>');
    expect(html).toContain('Anna &lt;Bol&gt;');
    expect(printListTitle('Print Lab queue')).toBe('Lab queue');
    expect(printListTitle('Print ')).toBe('Worklist');
    expect(printListTitle('Ward patients')).toBe('Ward patients');
  });

  it('drop live countdowns from time cells and keep clock times', () => {
    expect(printableTime('07:15', '7h 37m ago')).toBe('07:15');
    expect(printableTime('15:00', 'in 7m')).toBe('15:00');
    expect(printableTime('11:04', '3 hr 47 min')).toBe('11:04');
    expect(printableTime('16:30', 'in 1h 37m')).toBe('16:30');
    expect(printableTime('—', 'Assigned list')).toBe('— · Assigned list');
    expect(printableTime('09:00', 'Oct 3')).toBe('09:00 · Oct 3');
    expect(printableTime(undefined, null, '')).toBe('');
  });
});
