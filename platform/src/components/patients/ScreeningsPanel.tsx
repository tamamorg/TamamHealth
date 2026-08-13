'use client';

/**
 * Preventive-care screening reminders on the chart — the HealthBridge
 * "screenings due" surface. Lists outstanding (due / overdue) screenings with
 * one-tap mark-done (recurring screenings re-arm to the next interval), decline
 * and remove, plus an inline add form. Reads from the patient prop and mutates
 * via screening-service; the chart's live patient subscription refreshes it.
 */
import { useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';
import { ClipboardList, Plus, Check, X, Clock } from '@/components/icons/lucide';
import CodedSearchField from '@/components/CodedSearchField';
import { useConfirm } from '@/components/ConfirmDialog';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const COMMON_SCREENINGS = ['Blood pressure', 'HIV test', 'Cervical cancer (VIA)', 'Diabetes (blood glucose)', 'TB symptom screen', 'Well-child check', 'Nutrition (MUAC)'];
const screeningOptions = COMMON_SCREENINGS.map(s => ({ code: '', name: s }));

export default function ScreeningsPanel({ patient }: { patient: PatientDoc }) {
  const confirm = useConfirm();
  const { currentUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ type: string; dueDate: string; intervalMonths: string }>(
    { type: '', dueDate: todayISO(), intervalMonths: '' },
  );

  const today = todayISO();
  const due = (patient.screenings ?? []).filter((s) => s.status === 'due');
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setForm({ type: '', dueDate: todayISO(), intervalMonths: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function doAdd() {
    const svc = await import('@/lib/services/screening-service');
    await svc.addScreening(patient._id, {
      type: form.type.trim(),
      dueDate: form.dueDate || undefined,
      intervalMonths: form.intervalMonths ? parseInt(form.intervalMonths, 10) : undefined,
      ...author,
    });
  }
  async function doComplete(id: string) {
    const svc = await import('@/lib/services/screening-service');
    await svc.completeScreening(patient._id, id);
  }
  async function doDecline(id: string) {
    const svc = await import('@/lib/services/screening-service');
    await svc.declineScreening(patient._id, id);
  }
  async function doRemove(id: string) {
    const svc = await import('@/lib/services/screening-service');
    await svc.removeScreening(patient._id, id);
  }

  return (
    <div className="card-elevated p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <h3 className="font-semibold text-sm">Screenings due</h3>
          {due.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>{due.length}</span>
          )}
        </div>
        {!adding && (
          <button className="btn btn-xs btn-secondary" onClick={() => setAdding(true)}>
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {due.length === 0 && !adding ? (
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>No screenings due.</p>
      ) : (
        <div className="space-y-1.5">
          {due.map((s) => {
            const overdue = !!s.dueDate && s.dueDate < today;
            return (
              <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{s.type}</div>
                  <div className="inline-flex items-center gap-1 text-[11px]" style={{ color: overdue ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>
                    {overdue && <Clock className="w-3 h-3" />}
                    <span>{overdue ? `Overdue · due ${s.dueDate}` : `Due ${s.dueDate || '—'}`}{s.intervalMonths ? ` · every ${s.intervalMonths}mo` : ''}</span>
                  </div>
                </div>
                <button className="btn btn-xs btn-primary flex-shrink-0" disabled={busy} onClick={() => run(() => doComplete(s.id))} title="Mark done">
                  <Check className="w-3 h-3" /> Done
                </button>
                <button className="btn btn-xs btn-secondary flex-shrink-0" disabled={busy} onClick={() => run(() => doDecline(s.id))} title="Patient declined">Decline</button>
                <button className="p-1 rounded flex-shrink-0" disabled={busy} onClick={async () => {
                  const ok = await confirm({
                    title: 'Remove this screening?',
                    message: `${s.type} will be deleted from this patient's chart.`,
                    confirmLabel: 'Remove',
                    tone: 'danger',
                  });
                  if (ok) run(() => doRemove(s.id));
                }} title="Remove" style={{ color: 'var(--text-muted)' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <div className="mt-2 space-y-2">
          <CodedSearchField
            label="Screening"
            placeholder="Search or type a screening (e.g. Blood pressure)"
            options={screeningOptions}
            value={form.type}
            onChange={type => setForm({ ...form, type })}
            onSelect={o => setForm({ ...form, type: o.name })}
            showCodeBadge={false}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Due date
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full p-2 rounded-md text-[12px] mt-0.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
            </label>
            <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Recall (months, optional)
              <input type="number" min="0" value={form.intervalMonths} onChange={(e) => setForm({ ...form, intervalMonths: e.target.value })} placeholder="e.g. 12"
                className="w-full p-2 rounded-md text-[12px] mt-0.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy || form.type.trim().length === 0} onClick={() => run(doAdd)}>Save</button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => { setAdding(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
    </div>
  );
}
