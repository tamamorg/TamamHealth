'use client';

import { useState } from 'react';
import type { PatientDoc, ProblemDoc, PrescriptionDoc } from '@/lib/db-types';
import { ClipboardList, X } from '@/components/icons/lucide';
import AllergyList from './AllergyList';
import DirectiveList from './DirectiveList';
import Modal from '@/components/Modal';

export default function ChartSummaryPanel({
  patient,
  problems,
  prescriptions,
  onOpenProblems,
  hideListAddButtons = false,
}: {
  patient: PatientDoc;
  problems: ProblemDoc[];
  prescriptions: PrescriptionDoc[];
  onOpenProblems?: () => void;
  hideListAddButtons?: boolean;
}) {
  const activeProblems = problems.filter((p) => p.status === 'active' || p.status === 'chronic');
  const currentMeds = prescriptions
    .filter((rx) => rx.status !== 'dispensed')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 8);

  const [viewingProblem, setViewingProblem] = useState<ProblemDoc | null>(null);
  const [viewingMed, setViewingMed] = useState<PrescriptionDoc | null>(null);

  const colDivider: React.CSSProperties = { borderInlineEnd: '1px solid var(--border-light)' };
  const sectionHeader: React.CSSProperties = {
    background: 'var(--overlay-subtle)',
    borderBottom: '1px solid var(--border-light)',
    padding: '0 20px',
    height: 36,
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    letterSpacing: '0.04em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  };
  const modalCard = { background: 'var(--bg-card)', border: '1px solid var(--border-light)' };

  function DetailRow({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{value}</span>
      </div>
    );
  }

  return (
    <div className="card-elevated lg:col-span-3 lg:order-1 flex flex-col" style={{ overflow: 'hidden', height: 320 }}>
      {/* Header */}
      <div className="px-5 py-3 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: 'var(--border-light)' }}>
        <div className="flex items-center gap-2.5">
          <div className="icon-box-sm">
            <ClipboardList className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
          </div>
          <div>
            <h3 className="font-semibold text-sm" style={{ letterSpacing: -0.1 }}>Chart summary</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)', marginTop: 1 }}>
              Active problems · medications · directives · allergies
            </p>
          </div>
        </div>
      </div>

      {/* Four-column list */}
      <div className="grid grid-cols-4 flex-1 min-h-0 overflow-hidden">

        {/* Problems */}
        <div className="flex flex-col min-h-0" style={colDivider}>
          <div style={sectionHeader}>
            <span>Problems</span>
            {onOpenProblems && (
              <button onClick={onOpenProblems} style={{ fontSize: 11, fontWeight: 600, color: 'var(--tamamhealth-blue)', background: 'var(--accent-light)', borderRadius: 6, padding: '2px 10px' }}>
                Manage
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-none">
            {activeProblems.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No active problems</p>
            ) : (
              <ul>
                {activeProblems.map((p) => (
                  <li key={p._id}
                    className="py-2 cursor-pointer min-w-0"
                    onClick={() => setViewingProblem(p)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {(p.icd11Code || p.icd10Code) && (
                        <span className="flex-shrink-0" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {p.icd11Code || p.icd10Code}
                        </span>
                      )}
                      <span className="truncate" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                      {p.status === 'chronic' && (
                        <span className="flex-shrink-0" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chronic</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Medications */}
        <div className="flex flex-col min-h-0" style={colDivider}>
          <div style={sectionHeader}>
            <span>Medications</span>
            {currentMeds.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(33,145,208,0.12)', color: 'var(--accent-primary)', borderRadius: 10, padding: '1px 7px' }}>{currentMeds.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-none">
            {currentMeds.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>None active</p>
            ) : (
              <ul>
                {currentMeds.map((rx) => (
                  <li key={rx._id}
                    className="py-2 cursor-pointer min-w-0"
                    onClick={() => setViewingMed(rx)}
                  >
                    <div className="truncate font-semibold" style={{ fontSize: 12, color: 'var(--text-primary)' }}>{rx.medication}</div>
                    {(rx.dose || rx.frequency) && (
                      <div className="truncate" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{[rx.dose, rx.frequency].filter(Boolean).join(' · ')}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Directives */}
        <div className="flex flex-col min-h-0" style={colDivider}>
          <DirectiveList patient={patient} hideAddButton={hideListAddButtons} />
        </div>

        {/* Allergies */}
        <div className="flex flex-col min-h-0">
          <AllergyList patient={patient} hideAddButton={hideListAddButtons} />
        </div>

      </div>

      {/* Problem detail modal */}
      {viewingProblem && (
        <Modal onClose={() => setViewingProblem(null)} width={420} labelledBy="problem-detail-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="problem-detail-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{viewingProblem.name}</h2>
                {(viewingProblem.icd11Code || viewingProblem.icd10Code) && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-block', marginTop: 2 }}>
                    {viewingProblem.icd11Code || viewingProblem.icd10Code}
                  </span>
                )}
              </div>
              <button className="p-1 rounded hover:bg-gray-100 transition-colors flex-shrink-0" onClick={() => setViewingProblem(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Status" value={viewingProblem.status} />
              <DetailRow label="Start date" value={(viewingProblem as unknown as Record<string, string | undefined>).startDate} />
              <DetailRow label="ICD-11" value={viewingProblem.icd11Code} />
              <DetailRow label="ICD-10" value={viewingProblem.icd10Code} />
            </div>
            {(viewingProblem as unknown as Record<string, string | undefined>).notes && <DetailRow label="Notes" value={(viewingProblem as unknown as Record<string, string | undefined>).notes} />}
          </div>
        </Modal>
      )}

      {/* Medication detail modal */}
      {viewingMed && (
        <Modal onClose={() => setViewingMed(null)} width={420} labelledBy="med-detail-title">
          <div className="rounded-xl p-5 space-y-4" style={modalCard}>
            <div className="flex items-start justify-between gap-3">
              <h2 id="med-detail-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{viewingMed.medication}</h2>
              <button className="p-1 rounded hover:bg-gray-100 transition-colors flex-shrink-0" onClick={() => setViewingMed(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Dose" value={viewingMed.dose} />
              <DetailRow label="Frequency" value={viewingMed.frequency} />
              <DetailRow label="Route" value={(viewingMed as unknown as Record<string, string | undefined>).route} />
              <DetailRow label="Status" value={viewingMed.status} />
              <DetailRow label="Prescriber" value={(viewingMed as unknown as Record<string, string | undefined>).prescriberName} />
              <DetailRow label="Linked problem" value={viewingMed.linkedProblemLabel} />
            </div>
            <DetailRow label="Instructions" value={(viewingMed as unknown as Record<string, string | undefined>).instructions} />
          </div>
        </Modal>
      )}
    </div>
  );
}
