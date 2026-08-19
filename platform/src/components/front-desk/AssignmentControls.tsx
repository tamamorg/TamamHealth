'use client';

import { useState } from 'react';
import { MapPin, type LucideIcon } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { priorityColor, priorityLabelKey } from '@/lib/clinical/triage-display';
import Select from '@/components/Select';

/**
 * Care-team assignment for a row — the doctor carrying the visit and the nurse
 * covering the patient, each the same shape as the exam-room control beside
 * them: pick from the facility's staff, press the button, done in the row.
 *
 * The doctor path runs the shared provider assignment (patient fields, the
 * consultation tracker the provider's board reads, and the triage handoff
 * stamp), which is the same path the Assign-provider modal uses. The nurse path
 * only records who is covering, which is all nursing cover means here.
 */
export function StaffAssignmentControl({
  icon: Icon,
  label,
  staff,
  currentId,
  currentName,
  emptyLabel,
  onSave,
}: {
  icon: LucideIcon;
  label: string;
  staff: { _id: string; name?: string; username?: string }[];
  currentId?: string;
  currentName?: string;
  emptyLabel: string;
  onSave: (staffId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(currentId || '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="ehr-care-rooming">
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      <Select value={draft} onChange={event => setDraft(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {/* A provider assigned from elsewhere may not be in this facility's
            staff list; keep them selectable so the control never misreports. */}
        {currentId && !staff.some(person => person._id === currentId) && (
          <option value={currentId}>{currentName || 'Currently assigned'}</option>
        )}
        {staff.map(person => (
          <option key={person._id} value={person._id}>{person.name || person.username}</option>
        ))}
      </Select>
      <button
        type="button"
        disabled={saving || draft === (currentId || '')}
        onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
      >
        {saving ? 'Saving...' : currentId ? 'Update' : 'Assign'}
      </button>
    </div>
  );
}

// Exam-room assignment for a triage-sourced queue row. Saving state is local
// to this component (not page-level) because it now mounts fresh each time
// its row expands, rather than being the single target of a page-level modal.
export function RoomAssignmentControl({
  triageId,
  currentRoom,
  priority,
  roomOptions,
  onSave,
}: {
  triageId: string;
  currentRoom?: string;
  priority: 'RED' | 'YELLOW' | 'GREEN' | 'normal';
  roomOptions: string[];
  onSave: (triageId: string, room: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(currentRoom || '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="ehr-care-rooming">
      <MapPin className="w-4 h-4" />
      <span>Exam room</span>
      {/* The acuity belongs on the header line, not on a third line below the
          button — that extra line was what knocked this control out of
          alignment with the doctor and nurse pickers beside it. */}
      <span style={{ color: priorityColor(priority) }}>
        {t(priorityLabelKey(priority))}
      </span>
      <Select value={draft} onChange={(event) => setDraft(event.target.value)}>
        <option value="">Unassigned</option>
        {roomOptions.map(room => <option key={room} value={room}>{room}</option>)}
      </Select>
      <button
        type="button"
        disabled={saving}
        onClick={async () => { setSaving(true); try { await onSave(triageId, draft); } finally { setSaving(false); } }}
      >
        {saving ? 'Saving...' : currentRoom ? 'Update' : 'Assign'}
      </button>
    </div>
  );
}
