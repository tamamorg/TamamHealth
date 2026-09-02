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
import { Check, X } from '@/components/icons/lucide';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import CodedSearchField from '@/components/CodedSearchField';
import { useConfirm } from '@/components/ConfirmDialog';
import { todayIso } from '@/lib/date-utils';

function todayISO(): string {
  return todayIso();
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
    <ChartSection title="Screenings due" addLabel="Add" onAdd={() => setAdding(true)}>
      {due.length === 0 && !adding ? (
        <OmrsEmptyState itemLabel="screenings due" actionLabel="Add screening" onAction={() => setAdding(true)} />
      ) : due.length > 0 && (
        <table className="omrs-table omrs-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Screening</th>
              <th>Due date</th>
              <th>Recall</th>
              <th>Actions</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {due.map((s) => {
              const overdue = !!s.dueDate && s.dueDate < today;
              return (
                <tr key={s.id}>
                  <td className="omrs-cell-strong">{s.type}</td>
                  <td>{s.dueDate || '—'}</td>
                  <td>{s.intervalMonths ? `Every ${s.intervalMonths} months` : '—'}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <button className="btn btn-xs btn-primary" disabled={busy} onClick={() => run(() => doComplete(s.id))} title="Mark done">
                        <Check className="w-3 h-3" /> Done
                      </button>
                      <button className="btn btn-xs btn-secondary" disabled={busy} onClick={() => run(() => doDecline(s.id))} title="Patient declined">Decline</button>
                      <button className="btn btn-xs btn-secondary" disabled={busy} onClick={async () => {
                        const ok = await confirm({
                          title: 'Remove this screening?',
                          message: `${s.type} will be deleted from this patient's chart.`,
                          confirmLabel: 'Remove',
                          tone: 'danger',
                        });
                        if (ok) run(() => doRemove(s.id));
                      }} title="Remove" aria-label="Remove screening">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className={overdue ? 'omrs-panel-badge omrs-panel-badge--pending' : 'omrs-panel-badge omrs-panel-badge--active'}>
                      {overdue ? 'Overdue' : 'Due'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
    </ChartSection>
  );
}
