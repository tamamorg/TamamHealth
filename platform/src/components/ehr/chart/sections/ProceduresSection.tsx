'use client';

/**
 * Procedures tab content — bedside/theatre procedures backed by ProcedureDoc +
 * procedure-service + useProcedures, mirroring the ConditionsSection read+add
 * pattern. Free-text name with an optional code; not validated against a
 * coding system today.
 */

import { useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import Modal from '@/components/Modal';
import { X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useProcedures } from '@/lib/hooks/useProcedures';
import { formatDate } from '@/lib/format-utils';
import { procedure as procedureLifecycle, type ProcedureStatus } from '@/lib/clinical-flow/order-lifecycles';
import { todayIso } from '@/lib/date-utils';

/** Stage 7 states, worded the way a clinician would say them. */
const PROCEDURE_STATUS_LABELS: Record<ProcedureStatus, string> = {
  ordered: 'Ordered',
  consented: 'Consented',
  in_progress: 'In progress',
  completed: 'Completed',
  in_observation: 'In observation',
  released: 'Released',
  aborted: 'Aborted',
  complication: 'Complication',
  ae_reported: 'Adverse event reported',
};

interface ProceduresSectionProps {
  patientId: string;
  patientName: string;
  canConsult: boolean;
}

export default function ProceduresSection({ patientId, patientName, canConsult }: ProceduresSectionProps) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { procedures, create, advance } = useProcedures(patientId);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [date, setDate] = useState(() => todayIso());
  const [bodySite, setBodySite] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState<string | null>(null);

  /**
   * Move one procedure to its next Stage 7 state. The picker only ever offers
   * moves the lifecycle allows, and 'aborted' is prompted for its reason
   * because the document specifies "aborted (with reason)" — the service
   * refuses the move without one.
   */
  const advanceTo = async (id: string, to: ProcedureStatus) => {
    let reason: string | undefined;
    if (to === 'aborted') {
      reason = window.prompt('Why was this procedure aborted?')?.trim() || undefined;
      if (!reason) return;
    }
    setAdvancing(id);
    try {
      await advance(id, to, { actorId: currentUser?._id, actorName: currentUser?.name, reason });
      showToast(`Procedure moved to ${PROCEDURE_STATUS_LABELS[to]}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the procedure.', 'error');
    } finally {
      setAdvancing(null);
    }
  };

  const resetForm = () => {
    setName(''); setCode(''); setBodySite(''); setOutcome(''); setNotes('');
    setDate(todayIso());
    setAdding(false);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { showToast('Name the procedure first', 'error'); return; }
    if (!date) { showToast('Pick the procedure date', 'error'); return; }
    try {
      setSubmitting(true);
      await create({
        patientId,
        patientName,
        name: name.trim(),
        code: code.trim() || undefined,
        date,
        bodySite: bodySite.trim() || undefined,
        outcome: outcome.trim() || undefined,
        notes: notes.trim() || undefined,
        performedBy: currentUser?._id || currentUser?.username,
        performedByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      showToast('Procedure recorded', 'success');
      resetForm();
    } catch (err) {
      console.error(err);
      showToast('Could not record this procedure. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ChartSection title="Procedures" addLabel="Add" onAdd={canConsult ? () => setAdding(true) : undefined}>
        {procedures.length === 0 ? (
          <OmrsEmptyState
            itemLabel="procedures"
            actionLabel="Record procedures"
            onAction={canConsult ? () => setAdding(true) : undefined}
            disabledReason={canConsult ? undefined : 'Requires consultation permission'}
          />
        ) : (
          <table className="omrs-table">
            <thead>
              <tr>
                <th>Procedure</th>
                <th>Date</th>
                <th>Status</th>
                <th>Performed by</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {procedures.map(p => (
                <tr key={p._id}>
                  <td style={{ fontWeight: 600 }}>
                    {p.name}
                    {p.code ? <span style={{ color: 'var(--ehr-muted, #597386)', fontWeight: 400 }}> · {p.code}</span> : null}
                    {p.bodySite ? <div style={{ color: 'var(--ehr-muted, #597386)', fontWeight: 400, fontSize: 12 }}>{p.bodySite}</div> : null}
                  </td>
                  <td>{formatDate(p.date)}</td>
                  <td>
                    {/* A statusless row is a record of something already done —
                        every procedure written before the lifecycle existed.
                        It reads "Recorded" rather than being forced into a
                        state nobody put it in, and can still be picked up. */}
                    <span style={{ fontWeight: 600 }}>
                      {p.status ? PROCEDURE_STATUS_LABELS[p.status] : 'Recorded'}
                    </span>
                    {p.status === 'aborted' && p.abortedReason ? (
                      <div style={{ color: 'var(--ehr-muted, #597386)', fontWeight: 400, fontSize: 12 }}>{p.abortedReason}</div>
                    ) : null}
                    {canConsult && procedureLifecycle.next(p.status || 'ordered').length > 0 && (
                      <select
                        aria-label={`Advance ${p.name}`}
                        value=""
                        disabled={advancing === p._id}
                        onChange={e => { if (e.target.value) advanceTo(p._id, e.target.value as ProcedureStatus); }}
                        style={{
                          display: 'block', marginTop: 4, fontSize: 12, padding: '2px 4px',
                          border: '1px solid var(--border-light)', borderRadius: 6,
                          background: 'var(--bg-card-solid)', color: 'var(--text-primary)',
                        }}
                      >
                        <option value="">{advancing === p._id ? 'Saving…' : 'Advance to…'}</option>
                        {procedureLifecycle.next(p.status || 'ordered').map(next => (
                          <option key={next} value={next}>{PROCEDURE_STATUS_LABELS[next]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>{p.performedByName || '—'}</td>
                  <td>
                    {p.outcome || '—'}
                    {p.notes ? <div style={{ color: 'var(--ehr-muted, #597386)', fontSize: 12 }}>{p.notes}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartSection>

      {adding && (
        <Modal onClose={() => !submitting && resetForm()} width={480} labelledBy="add-procedure-title">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <h2 id="add-procedure-title" className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Record procedure</h2>
              <button className="p-1 rounded" onClick={() => !submitting && resetForm()} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Procedure</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Incision and drainage of abscess"
                autoFocus
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Code (optional)</label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Body site (optional)</label>
                <input
                  type="text"
                  value={bodySite}
                  onChange={e => setBodySite(e.target.value)}
                  placeholder="e.g. left forearm"
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Outcome (optional)</label>
                <input
                  type="text"
                  value={outcome}
                  onChange={e => setOutcome(e.target.value)}
                  placeholder="e.g. successful, no complications"
                  className="w-full p-2.5 rounded-md text-[13px]"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Notes (optional)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full p-2.5 rounded-md text-[13px]"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn btn-sm btn-secondary" disabled={submitting} onClick={resetForm}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={submitting || !name.trim()} onClick={handleSubmit}>
                {submitting ? 'Saving…' : 'Save procedure'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
