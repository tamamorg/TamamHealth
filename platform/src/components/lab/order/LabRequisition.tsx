'use client';

/**
 * The printable requisition — the paper that walks with the specimen.
 *
 * Deliberately monochrome and boxy: it is printed on whatever is in the tray
 * and read next to a bench, so it uses black rules and a single highlighted
 * test table rather than the app's screen palette. `@media print` in
 * lab-order.css hides everything except `.labord-print`.
 */

import { patientAgeLabel } from '@/lib/patient-utils';
import { formatDate, formatDateTime } from '@/lib/format-utils';
import { aoeKey, type LabOrderDraft, type LabOrderReceipt } from './lab-order-types';
import { coverageLabel } from './LabOrderPatientStrip';
import type { AoeQuestion, OrderedTest } from './lab-order-types';
import type { PatientDoc } from '@/lib/db-types';

/**
 * A deterministic bar pattern derived from the accession string. Not a real
 * Code-128 symbology — it is a visual anchor for the accession printed beneath
 * it, which is what the bench actually keys or scans from the label printer.
 */
function Barcode({ value }: { value: string }) {
  const bars: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    bars.push((code % 3) === 0 ? 2 : 1, (code % 2) === 0 ? 0 : 1, (code % 5) === 0 ? 2 : 1);
  }
  return (
    <div className="labord-barcode" aria-hidden>
      {bars.map((width, i) => <span key={i} data-w={width} />)}
    </div>
  );
}

export default function LabRequisition({
  draft,
  patient,
  receipt,
  facilityName,
  schedule,
}: {
  draft: LabOrderDraft;
  patient: PatientDoc;
  receipt: LabOrderReceipt;
  facilityName: string;
  schedule: { test: OrderedTest; questions: AoeQuestion[] }[];
}) {
  const accession = receipt.accessionNumbers[0] || receipt.orderGroupId;
  const priorityLabel = draft.priority.toUpperCase();
  const imaging = draft.kind === 'imaging';

  return (
    <div className="labord-requisition labord-print">
      <div className="labord-req-head">
        <div>
          <div className="labord-req-facility">{facilityName || 'TamamHealth'}</div>
          <div className="labord-req-meta">
            {imaging ? 'Imaging requisition' : 'Laboratory requisition'}<br />
            {draft.processing === 'send_out'
              ? (imaging ? 'Referred out — external imaging' : 'Send-out — reference laboratory')
              : (imaging ? 'In-house imaging unit' : 'In-house laboratory')}<br />
            Printed: {formatDateTime(receipt.placedAt)}
          </div>
        </div>
        <div style={{ textAlign: 'end' }}>
          {draft.priority !== 'routine' && <div className="labord-req-stat" style={{ marginBottom: 6 }}>{priorityLabel}</div>}
          <Barcode value={accession} />
          <div className="labord-req-meta" style={{ fontFamily: 'var(--font-mono, monospace)', marginTop: 2 }}>{accession}</div>
        </div>
      </div>

      <div className="labord-req-grid">
        <div>
          <div className="labord-req-label">Patient</div>
          <div className="labord-req-value">{patient.surname?.toUpperCase()}, {patient.firstName}</div>
        </div>
        <div>
          <div className="labord-req-label">Hospital number</div>
          <div className="labord-req-value">{patient.hospitalNumber || '—'}</div>
        </div>
        <div>
          <div className="labord-req-label">DOB</div>
          <div className="labord-req-value">{patient.dateOfBirth ? formatDate(patient.dateOfBirth) : '—'}</div>
        </div>
        <div>
          <div className="labord-req-label">Age / Sex</div>
          <div className="labord-req-value">{patientAgeLabel(patient)} / {patient.gender || '—'}</div>
        </div>
        <div>
          <div className="labord-req-label">Coverage</div>
          <div className="labord-req-value">{coverageLabel(patient)}</div>
        </div>
        <div>
          <div className="labord-req-label">Ordered by</div>
          <div className="labord-req-value">{draft.orderedByName || '—'}</div>
        </div>
        <div>
          <div className="labord-req-label">{imaging ? 'Study timing' : 'Collection'}</div>
          <div className="labord-req-value">
            {draft.collectionTiming === 'draw_now' ? (imaging ? 'Perform now' : 'Draw now')
              : draft.collectionTiming === 'lab_collect' ? (imaging ? 'Imaging unit to schedule' : 'Lab to collect')
              : draft.scheduledCollectionAt ? draft.scheduledCollectionAt.replace('T', ' ') : 'Scheduled'}
          </div>
        </div>
        <div>
          <div className="labord-req-label">Fasting</div>
          <div className="labord-req-value">{draft.fasting === 'yes' ? 'Yes' : draft.fasting === 'no' ? 'No' : 'Not stated'}</div>
        </div>
      </div>

      <div className="labord-req-grid" style={{ borderBottom: 0 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="labord-req-label">Diagnoses / indications</div>
          <div className="labord-req-value">
            {draft.indications.length
              ? draft.indications.map(indication => `${indication.code} ${indication.title}`).join('  ·  ')
              : '—'}
          </div>
        </div>
      </div>

      <table className="labord-req-table">
        <thead>
          <tr>
            <th style={{ width: '30%' }}>{imaging ? 'Study' : 'Test'}</th>
            <th style={{ width: '16%' }}>{imaging ? 'Modality' : 'Specimen'}</th>
            <th style={{ width: '14%' }}>LOINC</th>
            <th>Order-entry answers</th>
          </tr>
        </thead>
        <tbody>
          {draft.tests.map(test => {
            const questions = schedule.find(entry => entry.test.name === test.name)?.questions || [];
            const answers = questions
              .map(question => ({ label: question.label, value: draft.aoe[aoeKey(test.name, question.id)] || '' }))
              .filter(entry => entry.value.trim().length > 0);
            return (
              <tr key={test.name}>
                <td><strong>{test.name}</strong></td>
                <td>{test.specimen}</td>
                <td>{test.loinc || '—'}</td>
                <td>{answers.length ? answers.map(a => `${a.label} ${a.value}`).join('; ') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {(draft.notes.trim() || draft.comments.trim()) && (
        <div style={{ marginTop: 12 }}>
          {draft.notes.trim() && (
            <>
              <div className="labord-req-label">{imaging ? 'Notes to the imaging unit' : 'Notes to the laboratory'}</div>
              <div className="labord-req-value" style={{ fontWeight: 400 }}>{draft.notes}</div>
            </>
          )}
          {draft.comments.trim() && (
            <div style={{ marginTop: 6 }}>
              <div className="labord-req-label">Comment</div>
              <div className="labord-req-value" style={{ fontWeight: 400 }}>{draft.comments}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 40, marginTop: 28 }}>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #111', paddingTop: 4 }} className="labord-req-label">
            {imaging ? 'Performed by / time' : 'Collected by / time'}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #111', paddingTop: 4 }} className="labord-req-label">
            {imaging ? 'Reported by / time' : 'Received at lab / time'}
          </div>
        </div>
      </div>
    </div>
  );
}
