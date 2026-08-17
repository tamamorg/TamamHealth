'use client';

import { shortenPersonName } from '@/lib/patient-utils';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useRooming } from '@/lib/hooks/useRooming';
import { BedDouble, Clock, CheckCircle2, ArrowRightLeft, LogIn, Activity, Save, X } from '@/components/icons/lucide';
import type { RoomingWorklistEntry } from '@/lib/services/rooming-service';
import { getVitalFlags, isVitalInRange, type VitalsInput } from '@/lib/clinical/vitals';
import Modal from '@/components/Modal';

/**
 * The rooming station (KAN-99 / KAN-108).
 *
 * The step between triage and the clinician: acknowledge the patient reached
 * the clinic, put them in a room, take rooming vitals, and mark them ready.
 * Every action drives a real encounter transition, so the clinician's worklist
 * updates as a consequence rather than by a separate write.
 */

const STEP_LABEL: Record<RoomingWorklistEntry['step'], string> = {
  awaiting_triage: 'Checked in · waiting for triage',
  awaiting_arrival: 'Not yet arrived',
  awaiting_rooming: 'Waiting for a room',
  being_roomed: 'In room',
};

/**
 * Wait bands. Colour is driven by how long someone has been waiting because
 * that is the only thing on this screen that gets worse on its own — nothing
 * else here needs to compete for attention.
 */
function waitTone(minutes: number): { bg: string; fg: string } {
  if (minutes >= 60) return { bg: 'var(--danger-light)', fg: 'var(--color-danger-text)' };
  if (minutes >= 30) return { bg: 'var(--warning-light)', fg: 'var(--color-warning-text)' };
  return { bg: 'var(--overlay-subtle)', fg: 'var(--text-secondary)' };
}

type RoomingVitals = VitalsInput & { height?: string };

const VITAL_FIELDS: Array<{ key: keyof RoomingVitals; label: string; unit: string; placeholder: string; rangeKey?: keyof typeof import('@/lib/clinical/vitals').VITAL_RANGES }> = [
  { key: 'temperature', label: 'Temperature', unit: '°C', placeholder: '36.8', rangeKey: 'temperature' },
  { key: 'systolic', label: 'Systolic BP', unit: 'mmHg', placeholder: '120', rangeKey: 'systolic' },
  { key: 'diastolic', label: 'Diastolic BP', unit: 'mmHg', placeholder: '80', rangeKey: 'diastolic' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', placeholder: '72', rangeKey: 'pulse' },
  { key: 'respiratoryRate', label: 'Respiratory rate', unit: '/min', placeholder: '16', rangeKey: 'respiratoryRate' },
  { key: 'spo2', label: 'Oxygen saturation', unit: '%', placeholder: '98', rangeKey: 'spo2' },
  { key: 'weight', label: 'Weight', unit: 'kg', placeholder: '65', rangeKey: 'weight' },
  { key: 'height', label: 'Height', unit: 'cm', placeholder: '170' },
  { key: 'painScore', label: 'Pain score', unit: '/10', placeholder: '0', rangeKey: 'painScore' },
  { key: 'bloodGlucose', label: 'Blood glucose', unit: 'mmol/L', placeholder: '5.5', rangeKey: 'bloodGlucose' },
  { key: 'gcs', label: 'GCS', unit: '/15', placeholder: '15', rangeKey: 'gcs' },
  { key: 'muac', label: 'MUAC', unit: 'cm', placeholder: '22', rangeKey: 'muac' },
];

const emptyVitals = (): RoomingVitals => ({
  temperature: '', systolic: '', diastolic: '', pulse: '', respiratoryRate: '', spo2: '',
  weight: '', height: '', painScore: '', bloodGlucose: '', gcs: '', muac: '', notes: '',
});

export default function RoomingWorkflow({ patientId }: { patientId?: string } = {}) {
  const router = useRouter();
  const { currentUser } = useAuth();
  const toast = useToast();
  const { entries, loading, error, markArrived, assignRoom, transferClinic, markReady, recordVitals } = useRooming();
  const visibleEntries = patientId ? entries.filter(entry => entry.encounter.patientId === patientId) : entries;

  // Room being typed, keyed by encounter — several patients can be part-way
  // through rooming at once, so a single shared input would leak one nurse's
  // half-finished entry onto another patient's row.
  const [roomDraft, setRoomDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [vitalsEntry, setVitalsEntry] = useState<RoomingWorklistEntry | null>(null);
  const [vitalsDraft, setVitalsDraft] = useState<RoomingVitals>(emptyVitals);
  const [vitalsSaving, setVitalsSaving] = useState(false);
  const [vitalsRecorded, setVitalsRecorded] = useState<Record<string, string>>({});

  const actor = { actorId: currentUser?._id, actorName: currentUser?.name };

  async function run(id: string, action: () => Promise<unknown>, success: string) {
    setBusy(id);
    try {
      await action();
      toast.showToast(success, 'success');
    } catch (err) {
      // Surface the machine's own message — "Assign a room before marking the
      // patient ready" is more use than a generic failure.
      toast.showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  const syncReadyProgress = async (encounter: RoomingWorklistEntry['encounter']) => {
    const { syncConsultationProgressStage } = await import('@/lib/services/consultation-progress-service');
    await syncConsultationProgressStage({
      patientId: encounter.patientId,
      patientName: encounter.patientName,
      hospitalId: encounter.hospitalId || currentUser?.hospitalId || 'facility-unassigned',
      hospitalName: encounter.hospitalName || currentUser?.hospitalName,
      orgId: encounter.orgId || currentUser?.orgId,
      encounterId: encounter._id,
      stage: 'waiting_for_provider',
      nextAction: 'Start consultation',
      actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
    });
  };

  const openVitals = (entry: RoomingWorklistEntry) => {
    setVitalsEntry(entry);
    setVitalsDraft(emptyVitals());
  };

  const saveVitals = async () => {
    if (!vitalsEntry || !currentUser) return;
    const entered = Object.entries(vitalsDraft).some(([key, value]) => key !== 'notes' && Boolean(value?.trim()));
    if (!entered) {
      toast.showToast('Enter at least one vital sign.', 'error');
      return;
    }
    for (const field of VITAL_FIELDS) {
      const value = vitalsDraft[field.key]?.trim();
      if (value && field.rangeKey && !isVitalInRange(field.rangeKey, value)) {
        toast.showToast(`${field.label} is outside the valid range. Check the value.`, 'error');
        return;
      }
    }
    setVitalsSaving(true);
    try {
      await recordVitals({
        patientId: vitalsEntry.encounter.patientId,
        patientName: vitalsEntry.encounter.patientName,
        hospitalId: vitalsEntry.encounter.hospitalId,
        hospitalName: vitalsEntry.encounter.hospitalName,
        orgId: vitalsEntry.encounter.orgId,
        encounterId: vitalsEntry.encounter._id,
        recordedById: currentUser._id,
        recordedByName: currentUser.name,
        vitals: vitalsDraft,
      });
      setVitalsRecorded(previous => ({ ...previous, [vitalsEntry.encounter._id]: new Date().toISOString() }));
      toast.showToast(`Vitals saved for ${vitalsEntry.encounter.patientName}`, 'success');
      setVitalsEntry(null);
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : 'Failed to save vitals', 'error');
    } finally {
      setVitalsSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading the rooming worklist…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-danger-text)' }}>{error}</div>;
  }

  return (
    <div data-tour="rooming-board" className="overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      {visibleEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BedDouble className="w-6 h-6 mb-2" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Nobody waiting</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Patients appear here the moment reception checks them in.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto" style={{ minHeight: 0 }}>
          {visibleEntries.map(({ encounter, step, waitingMinutes }) => {
            const tone = waitTone(waitingMinutes);
            const isBusy = busy === encounter._id;

            return (
              <div
                key={encounter._id}
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {/* The name opens this patient's focused rooming page. */}
                    <button
                      type="button"
                      className="text-sm font-semibold truncate text-left"
                      style={{ color: 'var(--accent-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      onClick={() => router.push(`/rooming/${encounter.patientId}`)}
                      title={`Room ${encounter.patientName}`}
                    >
                      {shortenPersonName(encounter.patientName)}
                    </button>
                    {encounter.roomNumber && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}
                      >
                        Room {encounter.roomNumber}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{STEP_LABEL[step]}</span>
                    {encounter.destinationClinic && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        · {encounter.destinationClinic}
                      </span>
                    )}
                    {vitalsRecorded[encounter._id] && (
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-success-text)' }}>· Vitals recorded</span>
                    )}
                  </div>
                </div>

                <span
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded flex-shrink-0"
                  style={{ background: tone.bg, color: tone.fg }}
                  title="Time since this visit started"
                >
                  <Clock className="w-3 h-3" /> {waitingMinutes}m
                </span>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Checked in and not yet assessed: the only thing to do is
                      triage them, and it opens as its own page. */}
                  {step === 'awaiting_triage' && (
                    <button
                      type="button"
                      onClick={() => router.push(`/triage/${encounter.patientId}`)}
                      className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded"
                      style={{ background: 'var(--accent-primary)', color: '#fff' }}
                    >
                      <Activity className="w-3.5 h-3.5" style={{ stroke: '#fff' }} /> Triage
                    </button>
                  )}

                  {step === 'awaiting_arrival' && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => run(encounter._id, () => markArrived(encounter._id, currentUser?._id), 'Patient marked arrived')}
                      className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded"
                      style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)' }}
                    >
                      <LogIn className="w-3.5 h-3.5" /> Arrived
                    </button>
                  )}

                  {step === 'awaiting_rooming' && (
                    <>
                      <input
                        value={roomDraft[encounter._id] || ''}
                        onChange={e => setRoomDraft(d => ({ ...d, [encounter._id]: e.target.value }))}
                        placeholder="Room"
                        aria-label={`Room for ${encounter.patientName}`}
                        className="text-xs px-2 py-1.5 rounded"
                        style={{ width: 76, border: '1px solid var(--border-light)', background: 'var(--bg-app)' }}
                      />
                      <button
                        type="button"
                        disabled={isBusy || !(roomDraft[encounter._id] || '').trim()}
                        onClick={() => run(
                          encounter._id,
                          () => assignRoom(encounter._id, roomDraft[encounter._id], actor),
                          'Room assigned',
                        )}
                        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded"
                        style={{ background: 'var(--accent-primary)', color: '#fff' }}
                      >
                        <BedDouble className="w-3.5 h-3.5" /> Assign
                      </button>
                    </>
                  )}

                  {step === 'being_roomed' && (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openVitals({ encounter, step, waitingMinutes })}
                        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded"
                        style={{ background: 'var(--overlay-subtle)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border)' }}
                      >
                        <Activity className="w-3.5 h-3.5" /> Vitals
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => run(encounter._id, async () => {
                          await markReady(encounter._id, actor);
                          // The encounter transition is the source of truth;
                          // an offline tracker sync must not tell the nurse
                          // that the ready handoff failed after it succeeded.
                          await syncReadyProgress(encounter).catch(() => undefined);
                        }, 'Ready for the clinician')}
                        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded"
                        style={{ background: 'var(--accent-primary)', color: '#fff' }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                      </button>
                    </>
                  )}

                  {step !== 'awaiting_arrival' && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        const clinic = window.prompt('Route this patient to which clinic?');
                        if (clinic?.trim()) {
                          run(encounter._id, () => transferClinic(encounter._id, clinic, actor), 'Patient re-routed');
                        }
                      }}
                      title="Route to a different clinic"
                      aria-label={`Route ${encounter.patientName} to a different clinic`}
                      className="flex items-center justify-center rounded"
                      style={{ width: 30, height: 30, color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {vitalsEntry && (
        <Modal onClose={() => { if (!vitalsSaving) setVitalsEntry(null); }} width={620} labelledBy="rooming-vitals-title">
          <div className="p-5" style={{ background: 'var(--bg-card-solid, var(--bg-card))' }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                  <h2 id="rooming-vitals-title" className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Record vitals</h2>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{vitalsEntry.encounter.patientName} · {vitalsEntry.encounter.hospitalNumber || 'No ID'}</p>
              </div>
              <button type="button" onClick={() => setVitalsEntry(null)} disabled={vitalsSaving} aria-label="Close" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {VITAL_FIELDS.map(field => {
                const flagged = Boolean(getVitalFlags(vitalsDraft)[field.key]);
                return (
                  <label key={field.key} className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    <span className="flex justify-between gap-2 mb-1"><span>{field.label}</span><span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{field.unit}</span></span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={vitalsDraft[field.key] || ''}
                      onChange={event => setVitalsDraft(current => ({ ...current, [field.key]: event.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full rounded border px-2.5 py-2 text-sm"
                      style={{ borderColor: flagged ? 'var(--color-danger)' : 'var(--border-light)', background: 'var(--bg-input, var(--bg-app))', color: 'var(--text-primary)' }}
                    />
                    {flagged && <span className="block mt-1 text-[10px]" style={{ color: 'var(--color-danger-text)' }}>Check this value</span>}
                  </label>
                );
              })}
            </div>
            <label className="block mt-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Notes
              <textarea value={vitalsDraft.notes || ''} onChange={event => setVitalsDraft(current => ({ ...current, notes: event.target.value }))} rows={2} className="w-full mt-1 rounded border px-2.5 py-2 text-sm resize-none" placeholder="Position, oxygen, symptoms, or other observation" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-input, var(--bg-app))', color: 'var(--text-primary)' }} />
            </label>
            <div className="flex justify-end gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
              <button type="button" onClick={() => setVitalsEntry(null)} disabled={vitalsSaving} className="px-3 py-2 rounded text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Cancel</button>
              <button type="button" onClick={() => void saveVitals()} disabled={vitalsSaving} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent-primary)' }}>
                <Save className="w-3.5 h-3.5" /> {vitalsSaving ? 'Saving…' : 'Save vitals'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
