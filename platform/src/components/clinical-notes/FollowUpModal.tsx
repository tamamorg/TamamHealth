'use client';

/**
 * Schedule Follow-up — closes the note's "schedule_followup" plan action with
 * a real FollowUpDoc instead of the dead hand-off to /appointments (which only
 * filters an existing list; nothing there ever created a follow-up, so the
 * follow-up tracking service had no UI writer at all).
 *
 * Modeled on CareCoordinationModal: this component only collects the form
 * fields. The actual write (createFollowUp, then recordPlanAction through the
 * editor's persist() helper) happens in ClinicalNoteEditor's
 * handleScheduleFollowUp, which has the patient/note context this modal does
 * not — the same split CareCoordinationModal uses with handleCoordination.
 */

import { useState } from 'react';
import Modal from '@/components/Modal';
import { CalendarClock, X } from '@/components/icons/lucide';
import { toIsoDate } from '@/lib/date-utils';
import './clinical-notes.css';

export interface FollowUpModalResult {
  condition: string;
  scheduledDate: string;
  assignedWorkerName: string;
  notes: string;
}

interface FollowUpModalProps {
  patientName: string;
  /** Prefilled into "Assigned to" — defaults to whoever is signed in. */
  defaultAssignedWorkerName: string;
  onSchedule: (result: FollowUpModalResult) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Today + 7 days, as YYYY-MM-DD — the default follow-up window. Local
 * calendar, not UTC: in Juba (UTC+3) a `toISOString()` slice taken before
 * 03:00 local names yesterday, dating the follow-up a day early.
 */
function defaultScheduledDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return toIsoDate(d);
}

export default function FollowUpModal({
  patientName, defaultAssignedWorkerName, onSchedule, onClose,
}: FollowUpModalProps) {
  const [condition, setCondition] = useState('');
  const [scheduledDate, setScheduledDate] = useState(defaultScheduledDate);
  const [assignedWorkerName, setAssignedWorkerName] = useState(defaultAssignedWorkerName);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!condition.trim()) { setError('Enter the condition being followed up.'); return; }
    if (!scheduledDate) { setError('Pick a follow-up date.'); return; }
    setError('');
    setSaving(true);
    try {
      await onSchedule({
        condition: condition.trim(),
        scheduledDate,
        assignedWorkerName: assignedWorkerName.trim() || defaultAssignedWorkerName,
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule the follow-up.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={480} labelledBy="cn-followup-title">
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <CalendarClock size={17} aria-hidden />
          <h2 id="cn-followup-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, flex: 1 }}>
            Schedule Follow-up for {patientName}
          </h2>
          <button type="button" className="cn-tool" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <label className="cn-field" style={{ marginBottom: 12, width: '100%' }}>
          <span className="cn-label" style={{ minWidth: 96 }}>Condition</span>
          <input
            className="cn-input"
            style={{ flex: 1 }}
            value={condition}
            onChange={e => setCondition(e.target.value)}
            placeholder="What is being followed up…"
            autoFocus
          />
        </label>

        <label className="cn-field" style={{ marginBottom: 12, width: '100%' }}>
          <span className="cn-label" style={{ minWidth: 96 }}>Follow-up date</span>
          <input
            type="date"
            className="cn-input"
            style={{ flex: 1 }}
            value={scheduledDate}
            onChange={e => setScheduledDate(e.target.value)}
          />
        </label>

        <label className="cn-field" style={{ marginBottom: 12, width: '100%' }}>
          <span className="cn-label" style={{ minWidth: 96 }}>Assigned to</span>
          <input
            className="cn-input"
            style={{ flex: 1 }}
            value={assignedWorkerName}
            onChange={e => setAssignedWorkerName(e.target.value)}
            placeholder="Worker responsible for this follow-up"
          />
        </label>

        <label className="cn-field" style={{ marginBottom: 4, width: '100%', alignItems: 'flex-start' }}>
          <span className="cn-label" style={{ minWidth: 96, marginTop: 8 }}>Notes</span>
          <textarea
            className="cn-textarea"
            style={{ flex: 1, minHeight: 64 }}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything the follow-up worker should know (optional)…"
          />
        </label>

        {error && (
          <p style={{ color: 'var(--color-danger, #d92b20)', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="cn-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="cn-btn cn-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Scheduling…' : 'Schedule follow-up'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
