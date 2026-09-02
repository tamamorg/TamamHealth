'use client';

/**
 * Patient reminders — queue a message to reach the patient on a future date
 * (e.g. "Come fasted in 3 weeks for path tests"). The HealthBridge scheduled-SMS
 * idea, built honestly as a queue staff work from: there is no SMS gateway, so
 * reminders are marked sent manually (a real gateway can dispatch queued rows).
 */
import { useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc, ReminderChannel } from '@/lib/db-types';
import { usePatientReminders } from '@/lib/hooks/usePatientReminders';
import { patientFullName } from '@/lib/patient-utils';
import { Check, X } from '@/components/icons/lucide';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';

const CHANNELS: { v: ReminderChannel; label: string }[] = [
  { v: 'sms', label: 'SMS' },
  { v: 'whatsapp', label: 'WhatsApp' },
  { v: 'call', label: 'Call' },
  { v: 'in_person', label: 'In person' },
];

function todayISO(): string {
  return todayIso();
}

export default function RemindersPanel({ patient }: { patient: PatientDoc }) {
  const { currentUser } = useAuth();
  const { reminders, queued, queue, markSent, cancel } = usePatientReminders(patient._id);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ message: string; sendDate: string; channel: ReminderChannel }>(
    { message: '', sendDate: todayISO(), channel: 'sms' },
  );

  const today = todayISO();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await queue({
        patientId: patient._id,
        patientName: patientFullName(patient),
        message: form.message.trim(),
        sendDate: form.sendDate,
        channel: form.channel,
        createdById: currentUser?._id,
        createdByName: currentUser?.name || currentUser?.username,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
      });
      setForm({ message: '', sendDate: todayISO(), channel: 'sms' });
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue reminder');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChartSection title={queued.length > 0 ? `Reminders (${queued.length} queued)` : 'Reminders'} addLabel="Add" onAdd={() => setAdding(true)}>
      {adding && (
        <div className="space-y-2 mb-3">
          <textarea
            value={form.message}
            onChange={e => setForm({ ...form, message: e.target.value })}
            rows={2}
            placeholder="e.g. Come fasted in 3 weeks for your path tests"
            className="w-full p-2 rounded-md text-[12px]"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Send date
              <input type="date" value={form.sendDate} min={today} onChange={e => setForm({ ...form, sendDate: e.target.value })}
                className="w-full p-2 rounded-md text-[12px] mt-0.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
            </label>
            <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Channel
              <Select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value as ReminderChannel })}
                className="w-full p-2 rounded-md text-[12px] mt-0.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
              </Select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy || form.message.trim().length === 0} onClick={submit}>Queue reminder</button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => { setAdding(false); setError(null); }}>Cancel</button>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No SMS gateway is connected — this queues a reminder for staff to send and mark done.</p>
        </div>
      )}

      {reminders.length === 0 ? (
        !adding && <OmrsEmptyState itemLabel="reminders" actionLabel="Queue reminder" onAction={() => setAdding(true)} />
      ) : (
        <table className="omrs-table omrs-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Message</th>
              <th>Channel</th>
              <th>Send date</th>
              <th>Actions</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {reminders.map(r => {
              const overdue = r.status === 'queued' && r.sendDate < today;
              const muted = r.status !== 'queued';
              return (
                <tr key={r._id} style={muted ? { opacity: 0.6 } : undefined}>
                  <td className="omrs-cell-note">{r.message}</td>
                  <td>{CHANNELS.find(c => c.v === r.channel)?.label || r.channel}</td>
                  <td>{r.sendDate}</td>
                  <td>
                    {r.status === 'queued' && (
                      <div className="flex items-center gap-1.5">
                        <button className="btn btn-xs btn-primary" onClick={() => markSent(r._id)} title="Mark sent"><Check className="w-3 h-3" /> Sent</button>
                        <button className="btn btn-xs btn-secondary" onClick={() => cancel(r._id)} title="Cancel" aria-label="Cancel reminder"><X className="w-3 h-3" /></button>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={overdue
                      ? 'omrs-panel-badge omrs-panel-badge--pending'
                      : r.status === 'queued'
                        ? 'omrs-panel-badge omrs-panel-badge--active'
                        : r.status === 'sent'
                          ? 'omrs-panel-badge omrs-panel-badge--done'
                          : 'omrs-panel-badge omrs-panel-badge--muted'}>
                      {overdue ? 'Overdue' : r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {error && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
    </ChartSection>
  );
}
