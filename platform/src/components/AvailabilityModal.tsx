'use client';

/**
 * Quick "Add availability" modal — lets a provider publish a bookable window
 * (date + time range + slot length) that appointments can be booked
 * into. Opened from the TopBar quick-actions menu.
 */
import { useState } from 'react';
import { useAuth } from '@/lib/context';
import { Calendar, Clock, X, Loader2, Check, AlertCircle } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';

const SLOT_OPTIONS = [15, 20, 30, 45, 60];

function nowTimePlus(hours: number): string {
  // Round to the next quarter hour, then add `hours`.
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15 + hours * 60, 0, 0);
  return d.toTimeString().slice(0, 5);
}

export default function AvailabilityModal({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const { currentUser } = useAuth();
  const today = todayIso();

  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState(nowTimePlus(0));
  const [endTime, setEndTime] = useState(nowTimePlus(3));
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [department, setDepartment] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (!currentUser) return;
    setSaving(true);
    try {
      const { createAvailability } = await import('@/lib/services/availability-service');
      await createAvailability(
        {
          providerId: currentUser._id,
          providerName: currentUser.name,
          facilityId: currentUser.hospitalId || '',
          facilityName: currentUser.hospitalName || currentUser.organization?.name || '',
          date,
          startTime,
          endTime,
          slotMinutes,
          modality: 'in_person' as const,
          department: department.trim() || undefined,
          notes: notes.trim() || undefined,
          orgId: currentUser.orgId,
          payam: currentUser.payam,
        },
        currentUser._id,
        currentUser.name,
      );
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add availability.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 rounded-xl shadow-2xl p-6"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Add availability</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:opacity-80"><X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          Publish a bookable window for <strong style={{ color: 'var(--text-primary)' }}>{currentUser?.name}</strong>
          {currentUser?.hospitalName ? ` at ${currentUser.hospitalName}` : ''}.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm flex items-center gap-2" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        <div className="space-y-4">
          <Field label="Date">
            <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time">
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle} />
            </Field>
            <Field label="End time">
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Slot length">
              <Select value={slotMinutes} onChange={e => setSlotMinutes(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle}>
                {SLOT_OPTIONS.map(s => <option key={s} value={s}>{s} min</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Department (optional)">
            <input type="text" value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. OPD, Pediatrics" className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle} />
          </Field>
          <Field label="Notes (optional)">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle} />
          </Field>
        </div>

        <div className="flex items-center gap-2 mt-4 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <Clock className="w-3 h-3" /> Patients and front-desk can book appointments into this window.
        </div>

        <div className="flex items-center justify-end gap-3 mt-5">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Publish availability
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
