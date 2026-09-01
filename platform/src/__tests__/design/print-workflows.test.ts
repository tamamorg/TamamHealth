/**
 * @jest-environment node
 *
 * Paper output is a clinical artifact, not a screenshot of whichever modal is
 * open. These checks keep print actions scoped and generated documents safe.
 */
import fs from 'fs';
import path from 'path';
import { buildClinicalPrintDocument } from '@/lib/print-document';
import { generateReceiptHTML, type ReceiptData } from '@/lib/services/receipt-service';

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
