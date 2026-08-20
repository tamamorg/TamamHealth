'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ArrowRightLeft, Check, Clock, FileText, HeartPulse, LogOut, X } from '@/components/icons/lucide';
import CreateNoteButton, { defaultNoteTypeFor } from '@/components/clinical-notes/CreateNoteButton';
import Modal from '@/components/Modal';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import { STAGE_LABELS, type QueueEntry, type QueueStage } from '@/lib/services/patient-queue-service';
import { formatClockTime, formatCompactDateTime } from '@/lib/format-utils';
import { initials, stateTint, shortenPersonName } from '@/lib/patient-utils';
import { PRIORITY_META } from '@/lib/clinical/triage-display';
import type { AppointmentDoc, TriageDoc } from '@/lib/db-types';

/* ─── Visit popup + move dialog (clinician worklist) ───
   Row click on "Patients assigned to you" opens this popup: the current
   visit at a glance (queue position, visit-note state, triage vitals with
   abnormal flags) plus a Previous-visit tab for continuity — the last chief
   complaint and diagnoses so the patient doesn't have to re-explain. The
   actions live here too: start/resume the consultation, open the chart,
   and Move (re-route / re-prioritise with an audited comment). */

export function waitLabel(minutes: number): string {
  if (minutes < 1) return 'just now';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours} hr ${mins} min` : `${mins} min`;
}

/** One triage vital prepared for the grid: value, unit, and an abnormal flag. */
type VitalCell = { label: string; value: string; unit: string; flag?: 'high' | 'low' };

function triageVitals(triage: TriageDoc): VitalCell[] {
  const cells: VitalCell[] = [];
  const num = (raw?: string) => {
    const parsed = parseFloat(raw || '');
    return Number.isFinite(parsed) ? parsed : null;
  };
  const temp = num(triage.temperature);
  if (temp !== null) cells.push({ label: 'Temperature', value: String(temp), unit: '°C', flag: temp >= 38 ? 'high' : temp < 35.5 ? 'low' : undefined });
  const sys = num(triage.systolic);
  const dia = num(triage.diastolic);
  if (sys !== null && dia !== null) cells.push({ label: 'BP', value: `${sys}/${dia}`, unit: 'mmHg', flag: sys < 90 ? 'low' : sys >= 140 ? 'high' : undefined });
  const pulse = num(triage.pulse);
  if (pulse !== null) cells.push({ label: 'Heart rate', value: String(pulse), unit: 'beats/min', flag: pulse > 100 ? 'high' : pulse < 50 ? 'low' : undefined });
  const spo2 = num(triage.oxygenSaturation);
  if (spo2 !== null) cells.push({ label: 'SpO2', value: String(spo2), unit: '%', flag: spo2 < 92 ? 'low' : undefined });
  const rr = num(triage.respiratoryRate);
  if (rr !== null) cells.push({ label: 'R. rate', value: String(rr), unit: 'breaths/min', flag: rr > 24 ? 'high' : rr < 10 ? 'low' : undefined });
  const weight = num(triage.weight);
  if (weight !== null) cells.push({ label: 'Weight', value: String(weight), unit: 'kg' });
  const glucose = num(triage.bloodGlucose);
  if (glucose !== null) cells.push({ label: 'Glucose', value: String(glucose), unit: 'mmol/L', flag: glucose < 3.5 ? 'low' : glucose > 11 ? 'high' : undefined });
  const pain = num(triage.painScore);
  if (pain !== null) cells.push({ label: 'Pain', value: String(pain), unit: '/ 10', flag: pain >= 7 ? 'high' : undefined });
  return cells;
}

export default function EhrVisitPopup({
  patientId,
  name,
  detail,
  acuity,
  wait,
  appointment,
  triage,
  lastTriage,
  entry,
  onClose,
  onCall,
  onCallLabel,
  onAcknowledge,
  onMove,
  onOpenChart,
  onStartTriage,
  onEscalate,
  onLwbs,
  onCreateNote,
  nurseActions,
  creatingNote = false,
  inline = false,
}: {
  patientId?: string;
  name: string;
  /** Age/gender or reason line under the name. */
  detail?: string;
  acuity: 'RED' | 'YELLOW' | 'GREEN';
  wait: string;
  appointment: AppointmentDoc | null;
  /** The patient's ACTIVE triage (inside the queue's 24h window), or null. */
  triage: TriageDoc | null;
  /**
   * The patient's most recent triage at any age. Vitals fall back to this so
   * an inpatient triaged on admission shows the last readings anyone actually
   * took, instead of "none recorded" once the queue window has passed them by.
   * Only ever read for display, and always stamped with its own date.
   */
  lastTriage?: TriageDoc | null;
  entry: QueueEntry | null;
  onClose: () => void;
  /** Take the patient now — records the handoff and opens the consultation. */
  onCall: () => void;
  /** Override the inline primary action label for role-specific workflows. */
  onCallLabel?: string;
  /** Acknowledge the nurse's clinical handoff without starting consultation. */
  onAcknowledge?: () => void;
  /** Opens the Move dialog (only offered while a queue entry exists). */
  onMove?: () => void;
  onOpenChart?: () => void;
  /**
   * Open the ETAT triage assessment for this patient. The station that used
   * to own this verb is gone — the shared worklist is now where a triage
   * nurse meets an untriaged arrival, so the verb has to live here.
   */
  onStartTriage?: () => void;
  /**
   * Clinical dispositions — offered only while the visit is still waiting
   * (active triage with an encounter). The parent owns the confirm + writes.
   */
  onEscalate?: () => void;
  onLwbs?: () => void;
  /**
   * Start a clinical note for this visit. Offered here because the appointment
   * card already carries the patient, provider and date the
   * note header needs — creating from the chart makes the clinician re-select
   * all of it.
   */
  onCreateNote?: (noteType: import('@/lib/clinical-notes/note-catalog').NoteTypeId) => void;
  /** Role-specific actions that belong beside the visit tabs. */
  nurseActions?: React.ReactNode;
  creatingNote?: boolean;
  /** Render the panel in the flow of the list, under the row it belongs to,
   *  rather than as an overlay. The content is identical — only the frame
   *  differs — so a queue keeps its context while one visit is read. */
  inline?: boolean;
}) {
  const [tab, setTab] = useState<'current' | 'previous'>('current');
  const { records } = useMedicalRecords(patientId);
  const todayIso = new Date().toISOString().slice(0, 10);

  // Consultation notes only — nursing vitals snapshots are not visit notes.
  const consultations = useMemo(
    () => records
      .filter(record => (record.recordKind ?? 'consultation') === 'consultation')
      .sort((a, b) => (b.consultedAt || b.visitDate).localeCompare(a.consultedAt || a.visitDate)),
    [records],
  );
  const todaysNote = consultations.find(record => (record.consultedAt || record.visitDate).startsWith(todayIso));
  const previousNote = consultations.find(record => !(record.consultedAt || record.visitDate).startsWith(todayIso));

  // Vitals come from the active triage when there is one, and otherwise from
  // the last ETAT on record — an admitted patient's arrival assessment is
  // still the most recent set of readings taken. `vitalsAreCurrent` keeps the
  // two cases visually distinct so an old reading is never read as today's.
  const vitalsTriage = triage ?? lastTriage ?? null;
  const vitalsAreCurrent = Boolean(triage);
  const vitals = vitalsTriage ? triageVitals(vitalsTriage) : [];

  const body = (
      <div className={inline ? 'ehr-visit-pop ehr-visit-pop--inline' : 'modal-content card-elevated ehr-visit-pop'}>
        {/* Inline, the queue row directly above already names the patient and
            shows acuity and wait — the header would just say it twice. It stays
            for the dialog, which has no row above it. */}
        {!inline && (
          <div className="ehr-visit-pop-head">
            <span className="ehr-patient-icon" style={stateTint(acuity)} aria-hidden>
              {initials(name)}
            </span>
            <div className="ehr-visit-pop-head-text">
              <h3 id="ehr-visit-pop-title">{shortenPersonName(name)}</h3>
              {detail && <p className="ehr-visit-pop-detail">{detail}</p>}
            </div>
            {/* The header carries only what reception triages on at a glance —
             *  acuity and how long they've waited. Everything else (stage, care
             *  team, where they came from) lives in the card body below. */}
            <div className="ehr-visit-pop-tags">
              <span className="ehr-queue-pill" data-tone={PRIORITY_META[acuity].tone}>{PRIORITY_META[acuity].label}</span>
              {wait !== '—' && (
                <span className="ehr-visit-pop-chip is-wait">
                  <Clock className="w-3 h-3" aria-hidden /> {wait}
                </span>
              )}
            </div>
            <button type="button" className="ehr-visit-pop-close" aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></button>
          </div>
        )}

        <div className="ehr-visit-pop-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'current'} className={tab === 'current' ? 'active' : ''} onClick={() => setTab('current')}>
            Current visit
          </button>
          <button type="button" role="tab" aria-selected={tab === 'previous'} className={tab === 'previous' ? 'active' : ''} onClick={() => setTab('previous')}>
            Previous visit
          </button>
          {/* Open chart / Move / Start consultation sit on the tab line: the
              one row that is always visible, however far the visit scrolls. */}
          <div className="ehr-visit-pop-actions">
            {/* Labelled, not an icon: it sat beside the note button's own
                document glyph, so two identical-looking icons did different
                things. The note action keeps the glyph; this one says what it
                does. */}
            {onOpenChart && (
              <button type="button" className="ehr-visit-pop-icon ehr-visit-pop-labelled" onClick={onOpenChart} title="Open chart">
                <FileText className="w-4 h-4" aria-hidden /> Open chart
              </button>
            )}
            {onStartTriage && (
              <button type="button" className="ehr-visit-pop-icon ehr-visit-pop-labelled" onClick={onStartTriage} title="Open the ETAT triage assessment">
                <HeartPulse className="w-4 h-4" aria-hidden /> {triage ? 'Review triage' : 'Start triage'}
              </button>
            )}
            {onMove && entry && (
              <button type="button" className="ehr-visit-pop-icon" onClick={onMove} aria-label="Move to another queue" title="Move…">
                <ArrowRightLeft className="w-4 h-4" aria-hidden />
              </button>
            )}
            {onAcknowledge && triage && triage.handoffStatus !== 'acknowledged' && triage.handoffStatus !== 'in_consultation' && (
              <button type="button" className="ehr-visit-pop-icon ehr-visit-pop-labelled" onClick={onAcknowledge} title="Acknowledge the nurse handoff">
                <Check className="w-4 h-4" aria-hidden /> Acknowledge
              </button>
            )}
            {onEscalate && (
              <button
                type="button"
                className="ehr-visit-pop-icon ehr-visit-pop-labelled"
                onClick={onEscalate}
                title="Escalate this visit to emergency care"
              >
                <AlertTriangle className="w-4 h-4" aria-hidden /> Escalate
              </button>
            )}
            {onLwbs && (
              <button
                type="button"
                className="ehr-visit-pop-icon ehr-visit-pop-labelled"
                onClick={onLwbs}
                title="Record that the patient left without being seen"
              >
                <LogOut className="w-4 h-4" aria-hidden /> LWBS
              </button>
            )}
            {/* A plain split button now: the label creates the note the visit
                most likely needs, the caret past the divider picks a different
                type. */}
            {onCreateNote && patientId && (
              <CreateNoteButton
                tone="primary"
                defaultType={defaultNoteTypeFor({
                  reason: appointment?.reason || triage?.chiefComplaint,
                })}
                disabled={creatingNote}
                onCreate={onCreateNote}
              />
            )}
            {nurseActions}
          </div>
        </div>

        {tab === 'current' ? (
          <div className="ehr-visit-pop-body">
            {/* No Status row here: the queue row this panel drops out of already
                carries the status, the queue and where the patient came from. */}
            <div className="ehr-visit-pop-row">
              <span className="ehr-visit-pop-label">Visit</span>
              <div>
                <strong>{appointment ? `${appointment.reason || 'Facility visit'}` : triage?.chiefComplaint || 'Walk-in visit'}</strong>
                <p>
                  {appointment?.appointmentTime
                    ? `Scheduled today · ${formatClockTime(appointment.appointmentTime)}`
                    : triage
                      ? `Arrived · triaged ${formatClockTime(triage.triagedAt.slice(11, 16))}`
                      /* Dated, and never "Arrived": the reading is real but it
                         belongs to an earlier day, not to today's visit. */
                      : lastTriage
                        ? `Last triaged ${formatCompactDateTime(lastTriage.triagedAt)}`
                        : 'Not yet arrived'}
                </p>
              </div>
            </div>

            <div className="ehr-visit-pop-row">
              <span className="ehr-visit-pop-label">Visit note</span>
              <div>
                {todaysNote ? (
                  <>
                    <strong>{todaysNote.chiefComplaint || 'Consultation note'}</strong>
                    <p>{todaysNote.providerName} · {todaysNote.documentStatus === 'signed' ? 'Signed' : 'Draft'}</p>
                  </>
                ) : (
                  <p>Visit form has not been completed for this visit</p>
                )}
                {patientId && (
                  <button type="button" className="ehr-visit-pop-link" onClick={onCall}>
                    {onCallLabel || (todaysNote ? 'Open consultation' : 'Visit note form')} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {triage && (triage.disposition || triage.destinationClinic || triage.assignedProviderName || triage.handoffNote) && (
              <div className="ehr-visit-pop-row">
                <span className="ehr-visit-pop-label">Handoff</span>
                <div>
                  <strong>{triage.destinationClinic || 'Provider review'}</strong>
                  <p>
                    {triage.assignedProviderName ? `To ${triage.assignedProviderName}` : 'Provider unassigned'}
                    {triage.handoffStatus ? ` · ${triage.handoffStatus.replaceAll('_', ' ')}` : ''}
                  </p>
                  {triage.handoffNote && <p>{triage.handoffNote}</p>}
                </div>
              </div>
            )}

            <div className="ehr-visit-pop-row">
              {/* "Last vitals" only when there are older readings to show —
                  over an empty state it would promise a history that isn't
                  there (a walk-in still awaiting their first assessment). */}
              <span className="ehr-visit-pop-label">{vitalsTriage && !vitalsAreCurrent ? 'Last vitals' : 'Vitals'}</span>
              <div>
                {vitals.length === 0 ? (
                  <p>No triage vitals recorded yet.</p>
                ) : (
                  <>
                    <div className="ehr-visit-pop-vitals">
                      {vitals.map(cell => (
                        <div key={cell.label} className="ehr-visit-pop-vital">
                          <span>
                            {cell.label}
                            {cell.flag && <i className="ehr-visit-pop-flag" aria-label={`${cell.flag === 'high' ? 'Above' : 'Below'} normal range`} />}
                          </span>
                          <strong>
                            {cell.value} <small>{cell.unit}</small>
                            {cell.flag && <b aria-hidden>{cell.flag === 'high' ? '↑' : '↓'}</b>}
                          </strong>
                        </div>
                      ))}
                    </div>
                    {vitalsTriage && (
                      <p className="ehr-visit-pop-stamp">
                        {vitalsAreCurrent
                          ? formatClockTime(vitalsTriage.triagedAt.slice(11, 16))
                          : formatCompactDateTime(vitalsTriage.triagedAt)} · {vitalsTriage.triagedByName}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="ehr-visit-pop-body">
            {previousNote ? (
              <>
                <div className="ehr-visit-pop-row">
                  <span className="ehr-visit-pop-label">Last visit</span>
                  <div>
                    <strong>{previousNote.chiefComplaint || 'Consultation'}</strong>
                    <p>{(previousNote.consultedAt || previousNote.visitDate).slice(0, 10)} · {previousNote.providerName} · {previousNote.department}</p>
                  </div>
                </div>
                {previousNote.diagnoses?.length > 0 && (
                  <div className="ehr-visit-pop-row">
                    <span className="ehr-visit-pop-label">Diagnoses</span>
                    <div>
                      {previousNote.diagnoses.map(diagnosis => (
                        <p key={`${diagnosis.icd10Code}-${diagnosis.name}`}>
                          <strong>{diagnosis.name}</strong>
                          {(diagnosis.icd11Code || diagnosis.icd10Code) && <small> · {diagnosis.icd11Code || diagnosis.icd10Code}</small>}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="ehr-visit-pop-row">
                <span className="ehr-visit-pop-label">Last visit</span>
                <div><p>No previous visits recorded at this facility.</p></div>
              </div>
            )}
          </div>
        )}

      </div>
  );

  if (inline) return body;

  return (
    <Modal onClose={onClose} width={500} labelledBy="ehr-visit-pop-title">
      {body}
    </Modal>
  );
}

/** Stages the Move dialog can write, given the triage transition rules
 *  (pending→seen is one-way, so there is no "back to Triage" destination). */
const MOVE_DESTINATIONS: { stage: QueueStage; label: string }[] = [
  { stage: 'awaiting_rooming', label: 'Rooming — waiting area' },
  { stage: 'awaiting_consultation', label: 'Consultation — exam room' },
];

/* Move dialog — destination, priority, and an audited comment. `Move` stays
   disabled until something actually changes, mirroring the OpenMRS dialog. */
export function EhrQueueMoveDialog({ entry, saving, onClose, onMove }: {
  entry: QueueEntry;
  saving: boolean;
  onClose: () => void;
  onMove: (change: { stage: QueueStage | null; priority: QueueEntry['acuity']; room: string; comment: string }) => void;
}) {
  const movable = entry.stage === 'awaiting_rooming' || entry.stage === 'awaiting_consultation' || entry.stage === 'awaiting_triage';
  const [stage, setStage] = useState<QueueStage>(
    entry.stage === 'awaiting_rooming' || entry.stage === 'awaiting_consultation' ? entry.stage : 'awaiting_rooming',
  );
  const [priority, setPriority] = useState<QueueEntry['acuity']>(entry.acuity);
  const [room, setRoom] = useState('');
  const [comment, setComment] = useState('');

  const stageChanged = movable && stage !== entry.stage;
  const roomMissing = stageChanged && stage === 'awaiting_consultation' && !room.trim();
  const dirty = stageChanged || priority !== entry.acuity || comment.trim().length > 0;

  return (
    <Modal onClose={onClose} width={520} labelledBy="ehr-queue-move-title">
      <div className="modal-content card-elevated ehr-queue-move">
        <div className="ehr-queue-move-head">
          <h3 id="ehr-queue-move-title">Move {shortenPersonName(entry.patientName)}</h3>
          <button type="button" aria-label="Close" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {movable ? (
          <fieldset>
            <legend>Service location</legend>
            {MOVE_DESTINATIONS.map(destination => (
              <label key={destination.stage} className="ehr-queue-move-option">
                <input
                  type="radio"
                  name="queue-destination"
                  checked={stage === destination.stage}
                  onChange={() => setStage(destination.stage)}
                />
                <span>
                  {destination.label}
                  {entry.stage === destination.stage && <em> (current)</em>}
                </span>
              </label>
            ))}
            {stageChanged && stage === 'awaiting_consultation' && (
              <label className="ehr-queue-move-room">
                <span>Exam room</span>
                <input
                  type="text"
                  value={room}
                  placeholder="e.g. Room 3"
                  onChange={event => setRoom(event.target.value)}
                />
              </label>
            )}
          </fieldset>
        ) : (
          <p className="ehr-queue-move-note">
            {STAGE_LABELS[entry.stage]} is driven by open orders, so this entry moves on its own
            when the order closes. Priority and comments still apply.
          </p>
        )}

        <fieldset>
          <legend>Priority</legend>
          <div className="ehr-queue-move-priorities">
            {(Object.keys(PRIORITY_META) as QueueEntry['acuity'][]).map(level => (
              <label key={level} className="ehr-queue-move-option">
                <input
                  type="radio"
                  name="queue-priority"
                  checked={priority === level}
                  onChange={() => setPriority(level)}
                />
                <span className="ehr-queue-pill" data-tone={PRIORITY_META[level].tone}>{PRIORITY_META[level].label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="ehr-queue-move-comment">
          <span>Comment</span>
          <textarea
            rows={3}
            value={comment}
            placeholder="Reason for the change — kept on the triage record"
            onChange={event => setComment(event.target.value)}
          />
        </label>

        <div className="ehr-queue-move-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={!dirty || roomMissing || saving}
            onClick={() => onMove({
              stage: stageChanged ? stage : null,
              priority,
              room: room.trim(),
              comment: comment.trim(),
            })}
          >
            {saving ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
