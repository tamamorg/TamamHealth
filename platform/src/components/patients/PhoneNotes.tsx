'use client';

import { Fragment, useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePhoneNotes } from '@/lib/hooks/usePhoneNotes';
import type { PatientDoc } from '@/lib/db-types';
import { X } from '@/components/icons/lucide';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { formatDateTime } from '@/lib/format-utils';
import { patientFullName } from '@/lib/patient-utils';
import { isClinicalAuthorRole } from '@/lib/clinical-roles';
import Select from '@/components/Select';

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  open: { cls: 'omrs-panel-badge omrs-panel-badge--pending', label: 'Open' },
  responded: { cls: 'omrs-panel-badge omrs-panel-badge--done', label: 'Responded' },
  closed: { cls: 'omrs-panel-badge omrs-panel-badge--muted', label: 'Closed' },
};

/**
 * Phone notes on the patient chart (P1.4). Log a patient call and route it to a
 * provider; the provider responds and the exchange stays on the chart. Mirrors
 * the Centricity phone note workflow.
 */
export default function PhoneNotes({ patient }: { patient: PatientDoc }) {
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { notes } = usePhoneNotes(patient._id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [form, setForm] = useState({ callerName: '', callerPhone: '', subject: '', message: '', routedToId: '' });

  const providers = useMemo(
    () => users.filter((u) => isClinicalAuthorRole(u.role)),
    [users],
  );
  const isProvider = isClinicalAuthorRole(currentUser?.role);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setRespondingId(null);
      setResponseText('');
      setForm({ callerName: '', callerPhone: '', subject: '', message: '', routedToId: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function doCreate() {
    const svc = await import('@/lib/services/phone-note-service');
    const routedTo = providers.find((p) => p._id === form.routedToId);
    await svc.createPhoneNote({
      patientId: patient._id,
      patientName: patientFullName(patient),
      callerName: form.callerName || patientFullName(patient),
      callerPhone: form.callerPhone || patient.phone,
      subject: form.subject,
      message: form.message,
      routedToId: routedTo?._id,
      routedToName: routedTo?.name,
      recordedById: currentUser?._id,
      recordedByName: currentUser?.name || currentUser?.username,
      hospitalId: patient.registrationHospital,
      orgId: patient.orgId,
    });
  }
  async function doRespond(id: string) {
    const svc = await import('@/lib/services/phone-note-service');
    await svc.respondToPhoneNote(id, responseText, { userId: currentUser?._id, userName: currentUser?.name || currentUser?.username || 'Provider', userRole: currentUser?.role });
  }
  async function doClose(id: string) {
    const svc = await import('@/lib/services/phone-note-service');
    await svc.closePhoneNote(id);
  }

  return (
    <ChartSection title="Phone notes" addLabel="Log call" onAdd={() => setAdding(true)}>
      {adding && (
        <div className="rounded-lg p-3 mb-3 space-y-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.callerName} onChange={(e) => setForm({ ...form, callerName: e.target.value })} placeholder="Caller (default: patient)"
              className="p-2 rounded-md text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
            <input value={form.callerPhone} onChange={(e) => setForm({ ...form, callerPhone: e.target.value })} placeholder="Caller phone"
              className="p-2 rounded-md text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
          </div>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject (e.g. Medication question)"
            className="w-full p-2 rounded-md text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
          <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={2} placeholder="What did the caller need?"
            className="w-full p-2 rounded-md text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
          <Select value={form.routedToId} onChange={(e) => setForm({ ...form, routedToId: e.target.value })}
            className="w-full p-2 rounded-md text-[12px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
            <option value="">Route to provider…</option>
            {providers.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy || form.subject.trim().length === 0 || form.message.trim().length === 0} onClick={() => run(doCreate)}>Save phone note</button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {notes.length === 0 && !adding && (
        <OmrsEmptyState itemLabel="phone notes" actionLabel="Log call" onAction={() => setAdding(true)} />
      )}

      {notes.length > 0 && (
        <table className="omrs-table omrs-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Message</th>
              <th>Caller</th>
              <th>Received</th>
              <th>Actions</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => {
              const badge = STATUS_BADGE[n.status] || STATUS_BADGE.open;
              const responding = respondingId === n._id;
              return (
                <Fragment key={n._id}>
                  <tr>
                    <td className="omrs-cell-strong">{n.subject}</td>
                    <td className="omrs-cell-note">{n.message}</td>
                    <td>
                      {n.callerName || 'Caller'}
                      {(n.recordedByName || n.routedToName) && (
                        <div className="omrs-cell-sub">
                          {[n.recordedByName && `logged by ${n.recordedByName}`, n.routedToName && `routed to ${n.routedToName}`].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>{formatDateTime(n.createdAt)}</td>
                    <td>
                      {n.status === 'open' && !responding && (
                        <div className="flex items-center gap-1.5">
                          {isProvider && (
                            <button className="btn btn-xs btn-primary" disabled={busy} onClick={() => setRespondingId(n._id)}>Respond</button>
                          )}
                          <button className="btn btn-xs btn-secondary" disabled={busy} onClick={() => run(() => doClose(n._id))}>Close</button>
                        </div>
                      )}
                    </td>
                    <td><span className={badge.cls}>{badge.label}</span></td>
                  </tr>
                  {/* The exchange itself — a full-width row under the call it
                      belongs to, so the table stays one row per call. */}
                  {(n.response || (n.status === 'open' && responding)) && (
                    <tr>
                      <td colSpan={6}>
                        {n.response && (
                          <div className="rounded-md p-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--color-success-text)' }}>
                              Response · {n.respondedByName} · {formatDateTime(n.respondedAt)}
                            </div>
                            <p className="text-[12px]" style={{ color: 'var(--text-secondary)', margin: 0 }}>{n.response}</p>
                          </div>
                        )}
                        {n.status === 'open' && responding && (
                          <div className="space-y-2">
                            <textarea value={responseText} onChange={(e) => setResponseText(e.target.value)} rows={2} placeholder="Type your response…"
                              className="w-full p-2 rounded-md text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
                            <div className="flex items-center gap-2">
                              <button className="btn btn-xs btn-primary" disabled={busy || responseText.trim().length === 0} onClick={() => run(() => doRespond(n._id))}>Send response</button>
                              <button className="btn btn-xs btn-secondary" disabled={busy} onClick={() => { setRespondingId(null); setResponseText(''); }}><X className="w-3 h-3" /> Cancel</button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {error && <p className="mt-2 text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
    </ChartSection>
  );
}
