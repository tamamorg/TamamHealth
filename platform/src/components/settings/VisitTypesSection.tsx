'use client';

/**
 * Visit types — the bookable service menu for a facility.
 *
 * Each row is a thing a patient can be booked for, and its duration is what the
 * booking screen steps its slot grid by. That is the whole reason this lives in
 * settings rather than being hard-coded: a 15-minute immunization and a
 * 40-minute new-patient visit cannot share one grid, and only the facility
 * knows which of its visits take how long.
 *
 * A facility that has never touched this list is running on the built-in
 * defaults, which are shown here exactly as they will behave. They are written
 * to the database the first time anything is changed, so editing one does not
 * silently discard the rest.
 */

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import Select from '@/components/Select';
import { Plus, Trash2, ClipboardCheck, Video } from '@/components/icons/lucide';
import type { VisitReasonDoc, BookingModality } from '@/lib/db-types-booking';
import type { AppointmentType } from '@/lib/db-types';

const DURATIONS = [10, 15, 20, 30, 40, 45, 60, 90];

const MODALITY_LABELS: Record<BookingModality, string> = {
  in_person: 'In person',
  telehealth: 'Virtual only',
  both: 'Either',
};

const TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'general', label: 'General consultation' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'anc', label: 'Antenatal' },
  { value: 'immunization', label: 'Immunization' },
  { value: 'lab', label: 'Laboratory' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'surgical', label: 'Surgical' },
  { value: 'dental', label: 'Dental' },
  { value: 'mental_health', label: 'Mental health' },
];

export default function VisitTypesSection({ facilityId: facilityIdProp }: { facilityId?: string }) {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const facilityId = facilityIdProp || currentUser?.hospitalId || '';
  const orgId = currentUser?.orgId || '';

  const [reasons, setReasons] = useState<VisitReasonDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDuration, setNewDuration] = useState(30);

  const load = useCallback(async () => {
    if (!facilityId) { setLoading(false); return; }
    try {
      const { getVisitReasonsForFacility, isDefaultVisitReason } =
        await import('@/lib/services/visit-reason-service');
      const list = await getVisitReasonsForFacility(facilityId, orgId);
      setReasons(list);
      setUsingDefaults(list.length > 0 && list.every(isDefaultVisitReason));
    } catch (err) {
      console.error('[VisitTypesSection]', err);
      showToast('Could not load visit types', 'error');
    } finally {
      setLoading(false);
    }
  }, [facilityId, orgId, showToast]);

  useEffect(() => { load(); }, [load]);

  /**
   * Any edit to a built-in first writes the whole default set, so the list the
   * user is looking at survives changing one row of it.
   */
  const materialiseIfNeeded = useCallback(async (): Promise<VisitReasonDoc[]> => {
    if (!usingDefaults) return reasons;
    const { ensureVisitReasonsPersisted } = await import('@/lib/services/visit-reason-service');
    const persisted = await ensureVisitReasonsPersisted(facilityId, orgId);
    setUsingDefaults(false);
    setReasons(persisted);
    return persisted;
  }, [usingDefaults, reasons, facilityId, orgId]);

  const patch = async (id: string, updates: Partial<VisitReasonDoc>) => {
    setBusyId(id);
    try {
      const list = await materialiseIfNeeded();
      // After materialising, the row carries a real _rev under the same id.
      const target = list.find(r => r._id === id);
      if (!target) throw new Error('That visit type is no longer in the list');
      const { updateVisitReason } = await import('@/lib/services/visit-reason-service');
      await updateVisitReason(target._id, updates, currentUser?._id, currentUser?.name);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save that change', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (reason: VisitReasonDoc) => {
    setBusyId(reason._id);
    try {
      await materialiseIfNeeded();
      // Retired, not deleted: appointments booked under it still point here.
      const { retireVisitReason } = await import('@/lib/services/visit-reason-service');
      await retireVisitReason(reason._id, currentUser?._id, currentUser?.name);
      await load();
      showToast(`"${reason.name}" removed from the booking menu`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove that visit type', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    if (!newName.trim()) return;
    setBusyId('new');
    try {
      await materialiseIfNeeded();
      const { createVisitReason } = await import('@/lib/services/visit-reason-service');
      await createVisitReason({
        orgId,
        facilityId,
        name: newName.trim(),
        durationMinutes: newDuration,
        availableToNewPatients: true,
        availableToReturningPatients: true,
        modality: 'in_person',
        providerIds: [],
        department: 'Outpatient',
        appointmentType: 'general',
      }, currentUser?._id, currentUser?.name);
      setNewName('');
      setNewDuration(30);
      setAdding(false);
      await load();
      showToast('Visit type added', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add that visit type', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (!facilityId) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Choose a facility to configure its visit types.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
        What a patient can be booked for, and how long each takes. The booking screen
        offers these and builds its times from each duration.
        {usingDefaults && ' This facility is using the standard set — change anything to make it your own.'}
      </p>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading visit types…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reasons.map(reason => (
            <div
              key={reason._id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '10px 12px', borderRadius: 12,
                border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)',
                opacity: busyId === reason._id ? 0.6 : 1,
              }}
            >
              <div style={{ minWidth: 160, flex: '1 1 200px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {reason.name}
                  {reason.modality === 'telehealth' && (
                    <Video className="w-3 h-3" style={{ display: 'inline', marginLeft: 6, verticalAlign: '-1px' }} />
                  )}
                </div>
                {reason.description && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{reason.description}</div>
                )}
              </div>

              <label className="sr-only" htmlFor={`dur-${reason._id}`}>Duration for {reason.name}</label>
              <Select
                id={`dur-${reason._id}`}
                className="fs-input"
                value={reason.durationMinutes}
                disabled={busyId === reason._id}
                onChange={e => patch(reason._id, { durationMinutes: Number(e.target.value) })}
                style={{ width: 'auto', minWidth: 104 }}
              >
                {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
              </Select>

              <label className="sr-only" htmlFor={`mod-${reason._id}`}>Attendance for {reason.name}</label>
              <Select
                id={`mod-${reason._id}`}
                className="fs-input"
                value={reason.modality}
                disabled={busyId === reason._id}
                onChange={e => patch(reason._id, { modality: e.target.value as BookingModality })}
                style={{ width: 'auto', minWidth: 118 }}
              >
                {(Object.keys(MODALITY_LABELS) as BookingModality[]).map(m => (
                  <option key={m} value={m}>{MODALITY_LABELS[m]}</option>
                ))}
              </Select>

              <label className="sr-only" htmlFor={`type-${reason._id}`}>Recorded as, for {reason.name}</label>
              <Select
                id={`type-${reason._id}`}
                className="fs-input"
                value={reason.appointmentType}
                disabled={busyId === reason._id}
                onChange={e => patch(reason._id, { appointmentType: e.target.value as AppointmentType })}
                style={{ width: 'auto', minWidth: 150 }}
              >
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>

              <button
                type="button"
                onClick={() => remove(reason)}
                disabled={busyId === reason._id}
                aria-label={`Remove ${reason.name}`}
                title="Remove from the booking menu"
                style={{
                  width: 32, height: 32, borderRadius: 999, flexShrink: 0,
                  border: '1px solid var(--border-light)', background: 'transparent',
                  color: 'var(--color-danger-text)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          {reasons.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No visit types. Add one below — until then the booking screen asks for a
              time by hand.
            </p>
          )}

          {/* ── Add ── */}
          {adding ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '10px 12px', borderRadius: 12,
                border: '1px dashed var(--border-medium)',
              }}
            >
              <input
                type="text"
                className="fs-input"
                value={newName}
                autoFocus
                placeholder="e.g. Wound dressing"
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add(); }}
                style={{ flex: '1 1 200px', minWidth: 160 }}
                aria-label="New visit type name"
              />
              <Select
                className="fs-input"
                value={newDuration}
                onChange={e => setNewDuration(Number(e.target.value))}
                style={{ width: 'auto', minWidth: 104 }}
                aria-label="New visit type duration"
              >
                {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
              </Select>
              <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={busyId === 'new' || !newName.trim()}>
                {busyId === 'new' ? 'Adding…' : 'Add'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setNewName(''); }}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm inline-flex items-center gap-2"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setAdding(true)}
            >
              <Plus className="w-4 h-4" /> Add visit type
            </button>
          )}
        </div>
      )}

      <p
        className="text-xs"
        style={{ color: 'var(--text-muted)', marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <ClipboardCheck className="w-3.5 h-3.5" />
        Clinic hours are set per clinician from Appointments → Availability. The booking
        screen shows real openings once a clinician has hours recorded.
      </p>
    </div>
  );
}
