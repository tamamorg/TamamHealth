'use client';

/**
 * Task list workspace panel — lists this patient's queued/sent reminders
 * (usePatientReminders, the same hook RemindersPanel/the 'recall' tab use)
 * as "tasks", with a lightweight inline form to queue a new one via the
 * hook's own `queue()` — no new service or data layer.
 */

import { useState } from 'react';
import { Plus, Calendar } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { usePatientReminders } from '@/lib/hooks/usePatientReminders';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { ChartPanelUser } from './types';
import { toIsoDate } from '@/lib/date-utils';

interface TaskListPanelProps {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  onClose: () => void;
  onGoToRecall: () => void;
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

function badgeClass(status: string): string {
  if (status === 'sent') return 'tamam-panel-badge tamam-panel-badge--done';
  if (status === 'cancelled') return 'tamam-panel-badge tamam-panel-badge--muted';
  return 'tamam-panel-badge tamam-panel-badge--pending';
}

export default function TaskListPanel({ patient, currentUser, onClose, onGoToRecall }: TaskListPanelProps) {
  const { showToast } = useToast();
  const { reminders, loading, queue } = usePatientReminders(patient._id);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [sendDate, setSendDate] = useState(tomorrowISO());
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    if (!message.trim()) return;
    try {
      setSubmitting(true);
      await queue({
        patientId: patient._id,
        patientName: patientFullName(patient),
        message: message.trim(),
        sendDate,
        createdById: currentUser?._id,
        createdByName: currentUser?.name,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
      });
      showToast('Task added', 'success');
      setMessage('');
      setSendDate(tomorrowISO());
      setAdding(false);
    } catch (err) {
      console.error(err);
      showToast('Could not add this task. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="tamam-drawer-body">
        <div className="tamam-panel-section-head" style={{ cursor: 'default' }}>
          <span className="tamam-panel-section-title">Tasks ({reminders.length})</span>
          {!adding && (
            <button type="button" className="tamam-panel-add-btn" onClick={() => setAdding(true)}>
              <Plus /> Add task
            </button>
          )}
        </div>

        {adding && (
          <div className="tamam-panel-field" style={{ marginTop: 4 }}>
            <label className="tamam-panel-label">Task</label>
            <textarea
              className="tamam-panel-textarea"
              style={{ minHeight: 50 }}
              placeholder="e.g. Call patient about missed dose"
              value={message}
              onChange={e => setMessage(e.target.value)}
              autoFocus
            />
            <label className="tamam-panel-label" style={{ marginTop: 8 }}>Due date</label>
            <input
              type="date"
              className="tamam-panel-input"
              value={sendDate}
              onChange={e => setSendDate(e.target.value)}
            />
            <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
              <button type="button" className="tamam-btn-ghost" style={{ background: 'var(--ehr-soft, #ECEEF1)', color: 'var(--ehr-text-body, #3C5574)' }} onClick={() => { setAdding(false); setMessage(''); }}>
                Cancel
              </button>
              <button type="button" className="tamam-btn-primary" disabled={!message.trim() || submitting} onClick={handleAdd}>
                {submitting ? 'Adding…' : 'Add task'}
              </button>
            </div>
          </div>
        )}

        {!loading && reminders.length === 0 && !adding && (
          <p className="tamam-panel-empty">No tasks yet.</p>
        )}

        {reminders.map(r => (
          <div className="tamam-panel-row" key={r._id}>
            <div>
              <div className="tamam-panel-row-main">{r.message}</div>
              <div className="tamam-panel-row-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar className="w-3 h-3" /> Due {r.sendDate}
              </div>
            </div>
            <span className={badgeClass(r.status)}>{r.status}</span>
          </div>
        ))}
      </div>
      <div className="tamam-drawer-footer">
        <button type="button" className="tamam-btn-ghost" onClick={onClose}>Close</button>
        <button type="button" className="tamam-btn-primary" onClick={onGoToRecall}>View all in Recall</button>
      </div>
    </>
  );
}
