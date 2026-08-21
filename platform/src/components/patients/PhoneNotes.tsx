'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePhoneNotes } from '@/lib/hooks/usePhoneNotes';
import type { PatientDoc } from '@/lib/db-types';
import { Phone, Plus, X } from '@/components/icons/lucide';
import { formatDateTime } from '@/lib/format-utils';
import { patientFullName } from '@/lib/patient-utils';
import { isClinicalAuthorRole } from '@/lib/clinical-roles';
import Select from '@/components/Select';

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: 'rgba(230, 114, 0,0.12)', fg: 'var(--color-warning-text)', label: 'Open' },
  responded: { bg: 'rgba(10, 110, 74,0.12)', fg: 'var(--color-success-text)', label: 'Responded' },
  closed: { bg: 'var(--overlay-subtle)', fg: 'var(--text-muted)', label: 'Closed' },
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm inline-flex items-center gap-2">
          <Phone className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> Phone notes
        </h3>
        {!adding && (
          <button className="btn btn-sm btn-secondary" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5" /> Log call
          </button>
        )}
      </div>

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
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No phone notes recorded.</p>
      )}

      <ul className="space-y-2">
        {notes.map((n) => {
          const ss = STATUS_STYLE[n.status] || STATUS_STYLE.open;
          return (
            <li key={n._id} className="rounded-lg p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: ss.bg, color: ss.fg }}>{ss.label}</span>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{n.subject}</span>
                <span className="flex-1" />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatDateTime(n.createdAt)}</span>
              </div>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>{n.message}</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                From {n.callerName || 'caller'}{n.recordedByName ? ` · logged by ${n.recordedByName}` : ''}{n.routedToName ? ` · routed to ${n.routedToName}` : ''}
              </p>

              {n.response && (
                <div className="mt-2 rounded-md p-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--color-success-text)' }}>
                    Response · {n.respondedByName} · {formatDateTime(n.respondedAt)}
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{n.response}</p>
                </div>
              )}

              {n.status === 'open' && (
                <div className="mt-2">
                  {respondingId === n._id ? (
                    <div className="space-y-2">
                      <textarea value={responseText} onChange={(e) => setResponseText(e.target.value)} rows={2} placeholder="Type your response…"
                        className="w-full p-2 rounded-md text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
                      <div className="flex items-center gap-2">
                        <button className="btn btn-xs btn-primary" disabled={busy || responseText.trim().length === 0} onClick={() => run(() => doRespond(n._id))}>Send response</button>
                        <button className="btn btn-xs btn-secondary" disabled={busy} onClick={() => { setRespondingId(null); setResponseText(''); }}><X className="w-3 h-3" /> Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {isProvider && (
                        <button className="btn btn-xs btn-primary" disabled={busy} onClick={() => setRespondingId(n._id)}>Respond</button>
                      )}
                      <button className="btn btn-xs btn-secondary" disabled={busy} onClick={() => run(() => doClose(n._id))}>Close</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
    </div>
  );
}
