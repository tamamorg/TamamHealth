/**
 * The portal sign-in slip a patient is handed — as text and as paper.
 *
 * One builder for both places a slip is issued (the end of registration, and a
 * re-issue from the chart), so the two cannot drift into handing patients
 * different instructions for the same account.
 *
 * Labels arrive translated; nothing here owns copy.
 */

import { printClinicalDocument } from '@/lib/print-document';
import { escapeHtml } from '@/lib/safe-html';

export interface PortalSlip {
  patientName: string;
  hospitalNumber?: string;
  username: string;
  /** Formatted activation code, exactly as the patient types it. */
  activationCode: string;
  expiresAt: string;
  facilityName?: string;
}

export interface PortalSlipLabels {
  documentLabel: string;
  patientInformation: string;
  patientName: string;
  hospitalNumber: string;
  username: string;
  activationCode: string;
  validUntil: string;
  stepsTitle: string;
  /** In order; the first one already carries the address. */
  steps: string[];
  footer: string;
}

export function portalSlipDate(expiresAt: string): string {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

/** What "Copy" puts on the clipboard. */
export function buildPortalSlipText(slip: PortalSlip, labels: PortalSlipLabels): string {
  return [
    `${labels.documentLabel} — ${slip.patientName}`,
    `${labels.username}: ${slip.username}`,
    `${labels.activationCode}: ${slip.activationCode}`,
    `${labels.validUntil}: ${portalSlipDate(slip.expiresAt)}`,
    '',
    ...labels.steps.map((step, i) => `${i + 1}. ${step}`),
  ].join('\n');
}

export function printPortalSlip(slip: PortalSlip, labels: PortalSlipLabels): void {
  const steps = labels.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  printClinicalDocument({
    title: slip.patientName,
    documentLabel: labels.documentLabel,
    facilityName: slip.facilityName,
    metaTitle: labels.patientInformation,
    meta: [
      { label: labels.patientName, value: slip.patientName },
      { label: labels.hospitalNumber, value: slip.hospitalNumber },
      { label: labels.username, value: slip.username },
      { label: labels.validUntil, value: portalSlipDate(slip.expiresAt) },
    ],
    safeBodyHtml: `
      <div class="notice keep">
        <div class="field-label">${escapeHtml(labels.activationCode)}</div>
        <div style="font:700 20pt/1.3 'Courier New',Courier,monospace;letter-spacing:.08em">${escapeHtml(slip.activationCode)}</div>
      </div>
      <section class="section"><h2 class="section-title">${escapeHtml(labels.stepsTitle)}</h2><ol>${steps}</ol></section>`,
    footer: labels.footer,
  });
}
