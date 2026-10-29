'use client';


export default function PatientChartPrintStyles() {
  return (
      <style dangerouslySetInnerHTML={{ __html: `
        .print-only { display: none; }

        @media print {
          /* ── Page setup ──
             A named page, so the full-bleed sheet belongs to this document
             alone. Unscoped, a zero page margin applied to every print made
             from the chart — the SBAR and the lab report came out with their
             text against the paper's edge. Later pages get a top and bottom
             margin; the first keeps none so the header band bleeds. */
          @page chart-record {
            size: A4;
            margin: 14mm 14mm 18mm;
          }

          html, body {
            background: #fff !important;
            color: #001d3f !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-family: var(--font-platform) !important;
            font-size: 9pt;
            line-height: 1.45;
          }

          /* Print the signed document and nothing else. Everything that is
             neither the document nor an ancestor of it leaves the flow, and
             its ancestors are released from the app shell's fixed-height,
             overflow-clipped frame. Hiding with visibility alone left the
             document inside that frame, so the record printed its first page
             and stopped — allergies, results and the signature block never
             reached paper. (The SBAR and lab-report buttons on this page go
             through printElementById, which does the same for their target.) */
          body:has(.print-doc-root) *:not(:has(.print-doc-root)):not(.print-doc-root):not(.print-doc-root *) {
            display: none !important;
          }
          html:has(.print-doc-root),
          body:has(.print-doc-root),
          body:has(.print-doc-root) :has(.print-doc-root) {
            display: block !important;
            position: static !important;
            float: none !important;
            width: auto !important;
            max-width: none !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            overflow: visible !important;
            transform: none !important;
            contain: none !important;
            background: none !important;
            box-shadow: none !important;
          }

          /* The display value has to be restored explicitly: this element also
             carries .print-only, whose "display: none" above is what keeps the
             document off the screen, and that rule stays in force inside this
             media block. */
          .print-doc-root {
            display: block !important;
            position: static;
            width: 100%;
            background: #fff;
            page: chart-record;
          }

          /* Reset everything inside the doc */
          .print-doc-root * {
            font-family: var(--font-platform) !important;
            box-sizing: border-box;
            animation: none !important;
            transition: none !important;
          }

          svg:not(.print-logo-svg) { display: none !important; }

          /* ── Header (O3 Visit Summary shape) ──
             Facility mark and name at the left, the document's title and its
             identifiers at the right, over one hairline. No band: the record
             is monochrome and photocopier-safe like every other printout. */
          .rx-header {
            background: none !important;
            padding: 0 0 4mm;
            border-bottom: 0.75pt solid #cfd6dd !important;
            display: flex;
            align-items: center;
            justify-content: space-between;
            page-break-inside: avoid;
          }
          .rx-header-left { display: flex; align-items: center; gap: 10pt; }
          .rx-logo-wrap { background: none !important; padding: 0; display: flex; }
          .rx-logo-wrap img { width: 34pt; height: 34pt; display: block !important; }
          .rx-facility-name { color: #001d3f !important; font-size: 14pt; font-weight: 700; letter-spacing: 0; }
          .rx-facility-sub { color: #3c5574 !important; font-size: 8pt; margin-top: 1pt; }
          .rx-doc-label { text-align: right; }
          .rx-doc-label .rx-doc-title { color: #001d3f !important; font-size: 12pt; font-weight: 700; text-transform: none; letter-spacing: 0; }
          .rx-doc-label .rx-doc-meta { color: #3c5574 !important; font-size: 8pt; margin-top: 2pt; line-height: 1.5; }

          /* ── Patient information ── */
          .rx-patient-banner {
            background: none !important;
            border-bottom: 0 !important;
            padding: 5mm 0 0;
            page-break-inside: avoid;
          }
          .rx-patient-name {
            font-size: 11pt;
            font-weight: 700;
            color: #001d3f !important;
            margin-bottom: 3pt;
            padding-bottom: 2pt;
            border-bottom: 0.75pt solid #cfd6dd !important;
          }
          .rx-patient-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7pt 14pt; padding-top: 3pt; }
          .rx-patient-field label {
            display: block;
            font-size: 7.5pt;
            font-weight: 400;
            text-transform: none;
            letter-spacing: 0;
            color: #3c5574 !important;
            margin-bottom: 1pt;
          }
          .rx-patient-field span { font-size: 9.5pt; color: #001d3f !important; font-weight: 700; }

          /* ── Body ── */
          .rx-body { padding: 5mm 0 0; }

          /* ── Section ── */
          .rx-section { margin-bottom: 12pt; page-break-inside: avoid; }
          .rx-section-title {
            font-size: 11pt;
            font-weight: 700;
            text-transform: none;
            letter-spacing: 0;
            color: #001d3f !important;
            border-bottom: 0.75pt solid #cfd6dd !important;
            padding-bottom: 2pt;
            margin-bottom: 5pt;
          }
          .rx-section-body { font-size: 9pt; color: #001d3f !important; }

          /* ── Two-column layout ── */
          .rx-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
          .rx-three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10pt; }

          /* ── Field inline ── */
          .rx-field { margin-bottom: 4pt; }
          .rx-field b { color: #333 !important; font-weight: 600; }

          /* ── Vitals table ── */
          .rx-vitals-table { width: 100%; border-collapse: collapse; }
          .rx-vitals-table td {
            border: 1pt solid #cfd6dd !important;
            padding: 4pt 8pt;
            font-size: 8pt;
            text-align: center;
            color: #001d3f !important;
          }
          .rx-vitals-table td { border: 0 !important; border-bottom: 0.5pt solid #e2e6eb !important; }
          .rx-vitals-table td:first-child { text-align: left; font-weight: 700; background: #f1f3f5 !important; color: #3c5574 !important; }

          /* ── Med / lab rows ── */
          .rx-row {
            border-bottom: 0.5pt solid #e2e6eb !important;
            padding: 3pt 0;
            font-size: 8.5pt;
            color: #001d3f !important;
          }
          .rx-row:last-child { border-bottom: none !important; }
          .rx-row b { color: #001d3f !important; }

          /* ── Diagnosis rows ── */
          .rx-dx-row { display: flex; gap: 8pt; align-items: baseline; margin-bottom: 3pt; }
          .rx-dx-code { font-size: 7pt; font-weight: 700; background: #f1f3f5 !important; color: #001d3f !important; padding: 1pt 5pt; border-radius: 2pt; flex-shrink: 0; }
          .rx-dx-name { font-size: 8.5pt; color: #001d3f !important; }
          .rx-dx-type { font-size: 7pt; color: #888 !important; margin-left: 4pt; }

          /* ── Allergy pill ── */
          .rx-allergy-row { display: flex; gap: 6pt; align-items: center; margin-bottom: 3pt; }
          .rx-allergy-sev { font-size: 7pt; font-weight: 700; padding: 1pt 5pt; border-radius: 3pt; }
          .rx-allergy-sev.severe { background: #fae6e4 !important; color: #d92b20 !important; }
          .rx-allergy-sev.moderate { background: #fef2c7 !important; color: #cc6600 !important; }
          .rx-allergy-sev.mild { background: #d8eee6 !important; color: #0A6E4A !important; }
          .rx-allergy-sev.unknown { background: #f1f3f5 !important; color: #555 !important; }

          /* ── Signature block ── */
          .rx-sig-block {
            margin-top: 14pt;
            padding-top: 10pt;
            border-top: 0.75pt solid #cfd6dd !important;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30pt;
            page-break-inside: avoid;
          }
          .rx-sig-label { font-size: 7.5pt; font-weight: 400; text-transform: none; letter-spacing: 0; color: #3c5574 !important; margin-bottom: 18pt; }
          .rx-sig-line { border-bottom: 1pt solid #333 !important; margin-bottom: 4pt; height: 1pt; }
          .rx-sig-name { font-size: 8.5pt; color: #001d3f !important; font-weight: 600; }
          .rx-sig-role { font-size: 7.5pt; color: #666 !important; }

          /* ── Footer ── */
          /* The page footer (facility, printed by, time, page n of N, system
             ID) is in the page margin on every page; this closing line only
             carries the confidentiality notice. */
          .rx-footer {
            background: none !important;
            border-top: 0.5pt solid #cfd6dd !important;
            padding: 3mm 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 7pt;
            color: #6b7f96 !important;
            margin-top: 10mm;
          }
          .rx-footer-conf { font-weight: 700; color: #d92b20 !important; }

          /* page break helpers */
          .rx-page-break { page-break-before: always; }
        }
      ` }} />
  );
}
