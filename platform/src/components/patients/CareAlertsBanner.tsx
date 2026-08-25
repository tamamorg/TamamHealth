'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';
import type { CareAlertCategory } from '@/data/mock';
import { AlertTriangle, Plus, X } from '@/components/icons/lucide';
import CareAlertFields, { CARE_ALERT_CATEGORY_LABELS } from '@/components/patients/CareAlertFields';

/**
 * Chart-permanent care alerts (P1.2). Active alerts render as a prominent
 * banner so patient-safety information (fall risk, difficult IV access, etc.)
 * is seen on every visit. Resolving opens a confirmation popup and requires a
 * reason (alerts are retained, never hard-deleted) — it used to unfold a bare
 * text field inside the banner, which put a one-click dismissal of a safety
 * alert next to the alert it dismissed.
 */
export default function CareAlertsBanner({ patient, hideAddButton = false }: { patient: PatientDoc; hideAddButton?: boolean }) {
  const { currentUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<{ category: CareAlertCategory; message: string; priority: 'high' | 'normal' }>(
    { category: 'clinical_risk', message: '', priority: 'high' },
  );

  const active = (patient.careAlerts ?? []).filter((a) => a.status === 'active');
  const resolvingAlert = active.find((a) => a.id === resolvingId) ?? null;
  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setResolvingId(null);
      setReason('');
      setForm({ category: 'clinical_risk', message: '', priority: 'high' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }
  async function doAdd() {
    const svc = await import('@/lib/services/care-alert-service');
    await svc.addCareAlert(patient._id, { ...form, ...author });
  }
  async function doResolve(id: string) {
    const svc = await import('@/lib/services/care-alert-service');
    await svc.resolveCareAlert(patient._id, id, reason);
  }

  // Nothing active and not composing → a slim "add" affordance only. When the
  // add control is hosted elsewhere (ChartSafetyActions toolbar), render nothing.
  if (active.length === 0 && !adding) {
    if (hideAddButton) return null;
    return (
      <div className="lg:col-span-3 lg:order-1 flex justify-end">
        <button className="btn btn-xs btn-secondary" onClick={() => setAdding(true)}>
          <Plus className="w-3 h-3" /> Add care alert
        </button>
      </div>
    );
  }

  return (
    <div className="lg:col-span-3 lg:order-1 space-y-2">
      {active.map((a) => {
        const high = a.priority === 'high';
        const bg = high ? 'rgba(224, 49, 39,0.12)' : 'rgba(230, 114, 0,0.12)';
        const color = high ? 'var(--color-danger)' : 'var(--color-warning-text)';
        return (
          <div key={a.id} className="card-elevated p-3 flex items-center gap-3" style={{ background: bg, border: `1px solid ${color}40` }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: '#fff', color }}>{CARE_ALERT_CATEGORY_LABELS[a.category]}</span>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{a.message}</span>
              </div>
              {a.recordedByName && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Added by {a.recordedByName}</span>}
            </div>
            <button
              className="btn btn-xs btn-secondary flex-shrink-0"
              disabled={busy}
              onClick={() => { setReason(''); setResolvingId(a.id); }}
            >
              <X className="w-3 h-3" /> Resolve
            </button>
          </div>
        );
      })}

      {!adding ? (
        hideAddButton ? null : (
          <div className="flex justify-end">
            <button className="btn btn-xs btn-secondary" onClick={() => setAdding(true)}>
              <Plus className="w-3 h-3" /> Add care alert
            </button>
          </div>
        )
      ) : (
        <div className="card-elevated p-3 space-y-2">
          <CareAlertFields
            category={form.category}
            priority={form.priority}
            message={form.message}
            onCategoryChange={category => setForm({ ...form, category })}
            onPriorityChange={priority => setForm({ ...form, priority })}
            onMessageChange={message => setForm({ ...form, message })}
          />
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy || form.message.trim().length === 0} onClick={() => run(doAdd)}>Save alert</button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}

      {resolvingAlert && (
        <Modal
          onClose={() => { if (!busy) { setResolvingId(null); setReason(''); } }}
          width={440}
          labelledBy="care-alert-resolve-title"
        >
          <div className="modal-panel p-4">
            <h2 id="care-alert-resolve-title" className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Resolve this care alert?
            </h2>
            <p className="text-[12.5px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
              It stops showing on the chart banner. The alert is kept with the reason you
              give here — it is never deleted.
            </p>

            <div className="rounded-lg p-3 mt-3" style={{ background: 'var(--overlay-subtle)' }}>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {CARE_ALERT_CATEGORY_LABELS[resolvingAlert.category]}
              </span>
              <p className="text-[13px] font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {resolvingAlert.message}
              </p>
              {resolvingAlert.recordedByName && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Added by {resolvingAlert.recordedByName}
                </p>
              )}
            </div>

            <label htmlFor="care-alert-resolve-reason" className="block text-[11px] mt-3 mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Reason (required)
            </label>
            <input
              id="care-alert-resolve-reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Reassessed — no longer a fall risk"
              className="w-full p-2 rounded-md text-[13px]"
              style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />

            <div className="flex justify-end gap-2 mt-4">
              <button
                className="btn btn-sm btn-secondary"
                disabled={busy}
                onClick={() => { setResolvingId(null); setReason(''); }}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy || reason.trim().length === 0}
                onClick={() => run(() => doResolve(resolvingAlert.id))}
              >
                {busy ? 'Saving…' : 'Resolve alert'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
