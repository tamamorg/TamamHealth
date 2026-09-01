'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { patientFullName, shortenPersonName } from '@/lib/patient-utils';
import { formatLongDate } from '@/lib/format-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  FileText, BedDouble, AlertCircle, X, Printer, Pill, Check, ClipboardCheck, RotateCcw,
} from '@/components/icons/lucide';
import type { HandoffPatientEntry, ShiftHandoffDoc } from '@/lib/db-types';
import { useMarEntries, useWardRoster } from './shared';
import { useHandoffs } from '@/lib/hooks/useHandoffs';
import ListSearch from './ListSearch';
import { toIsoDate } from '@/lib/date-utils';
import { printElementById } from '@/lib/safe-html';

// Per-patient SBAR + tasks captured in the editor (string form for the textarea).
interface SbarDraft {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  tasks: string; // newline-separated; split on save
}

const EMPTY_SBAR: SbarDraft = { situation: '', background: '', assessment: '', recommendation: '', tasks: '' };

// Derive the shift bucket from the current hour.
function deriveShift(hour: number): ShiftHandoffDoc['shift'] {
  if (hour >= 7 && hour < 15) return 'day';
  if (hour >= 15 && hour < 23) return 'evening';
  return 'night';
}

export default function HandoffWorkflow({
  variant = 'page',
  onClose,
  onSigned,
}: { variant?: 'page' | 'modal'; onClose?: () => void; onSigned?: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { wardPatients, patientTriageMap } = useWardRoster();
  const { marEntries } = useMarEntries();
  const { latest, create, acknowledge, unacknowledge } = useHandoffs();

  const [handoffNotes, setHandoffNotes] = useState('');
  const [incomingNurse, setIncomingNurse] = useState('');
  const [sbar, setSbar] = useState<Record<string, SbarDraft>>({});
  const [signing, setSigning] = useState(false);
  const [acking, setAcking] = useState(false);
  const [signedDoc, setSignedDoc] = useState<ShiftHandoffDoc | null>(null);
  // Inline search for the critical patient handover list.
  const [search, setSearch] = useState('');

  const now = new Date();
  const todayKey = toIsoDate(now); // YYYY-MM-DD
  const shift = deriveShift(now.getHours());
  const todayDate = formatLongDate(now);
  const nowTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Critical = RED triage priority (real triage when present, demo inline otherwise).
  const criticalPatients = useMemo(
    () => wardPatients.filter(p => (patientTriageMap.get(p._id)?.priority ?? p._triage?.priority) === 'RED'),
    [wardPatients, patientTriageMap],
  );
  // The displayed handover list, narrowed by the inline search (name match).
  const sq = search.trim().toLowerCase();
  const filteredCritical = sq
    ? criticalPatients.filter(p => patientFullName(p).toLowerCase().includes(sq))
    : criticalPatients;

  // REAL metric counts only — no synthesized figures.
  const totalPatients = wardPatients.length;
  const criticalCount = criticalPatients.length;
  const overdueMarCount = marEntries.filter(e => e.status === 'overdue').length;
  const dueMarCount = marEntries.filter(e => e.status === 'due').length;

  if (!currentUser) return null;

  const shiftLabel = (s: ShiftHandoffDoc['shift']) =>
    s === 'day' ? t('nurse.shiftDay') : s === 'evening' ? t('nurse.shiftEvening') : t('nurse.shiftNight');

  const updateSbar = (id: string, field: keyof SbarDraft, value: string) =>
    setSbar(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_SBAR), [field]: value } }));

  // Reverse an accidental SBAR/tasks entry for one patient — wipes the draft
  // back to empty (the handoff hasn't been signed yet, so this is purely local).
  const clearSbar = (id: string) =>
    setSbar(prev => ({ ...prev, [id]: { ...EMPTY_SBAR } }));

  const sbarHasContent = (d?: SbarDraft) =>
    !!d && (!!d.situation.trim() || !!d.background.trim() || !!d.assessment.trim() || !!d.recommendation.trim() || !!d.tasks.trim());

  // Sign off the shift: build a typed ShiftHandoffDoc and persist via the hook.
  const handleSignOff = async () => {
    if (signing || signedDoc) return;

    // Guard against a duplicate sign-off for the same nurse + shiftDate that
    // hasn't been acknowledged yet (prevents orphaned duplicates).
    if (
      latest &&
      latest.outgoingNurseId === currentUser._id &&
      latest.shiftDate === todayKey &&
      latest.status !== 'acknowledged'
    ) {
      showToast(t('nurse.handoffDuplicateToast'), 'error');
      return;
    }

    setSigning(true);
    try {
      // Structured per-patient SBAR + tasks for every critical patient that has
      // any detail entered. Patients with no detail are still listed (situational
      // awareness) but carry empty SBAR fields.
      const patients: HandoffPatientEntry[] = criticalPatients.map(p => {
        const d = sbar[p._id];
        const tasks = (d?.tasks ?? '')
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean);
        return {
          patientId: p._id,
          patientName: patientFullName(p),
          hospitalNumber: p.hospitalNumber || undefined,
          priority: 'RED',
          situation: d?.situation?.trim() || undefined,
          background: d?.background?.trim() || undefined,
          assessment: d?.assessment?.trim() || undefined,
          recommendation: d?.recommendation?.trim() || undefined,
          tasks: tasks.length ? tasks : undefined,
        };
      });

      // Real metrics only — omit values we don't truly have.
      const metrics: ShiftHandoffDoc['metrics'] = {
        totalPatients,
        critical: criticalCount,
        overdueMar: overdueMarCount,
        dueMar: dueMarCount,
      };

      const doc = await create({
        facilityId: currentUser.hospitalId,
        facilityName: currentUser.hospitalName,
        orgId: currentUser.orgId,
        shiftDate: todayKey,
        shift,
        outgoingNurseId: currentUser._id,
        outgoingNurseName: currentUser.name,
        incomingNurseName: incomingNurse.trim() || undefined,
        notes: handoffNotes.trim() || undefined,
        patients,
        metrics,
      });

      setSignedDoc(doc);
      showToast(t('nurse.handoffSignedToast'), 'success');
      onSigned?.();
      if (variant === 'modal') setTimeout(() => onClose?.(), 1600);
    } catch (err) {
      console.error('Failed to sign handoff:', err);
      showToast(t('nurse.handoffSignFailedToast'), 'error');
    } finally {
      setSigning(false);
    }
  };

  // Oncoming nurse acknowledges the latest signed handoff.
  const handleAcknowledge = async () => {
    if (!latest || acking) return;
    setAcking(true);
    try {
      await acknowledge(latest._id, currentUser._id, currentUser.name);
      showToast(t('nurse.handoffAcknowledgedToast'), 'success');
    } catch (err) {
      console.error('Failed to acknowledge handoff:', err);
      showToast(t('nurse.handoffAcknowledgeFailedToast'), 'error');
    } finally {
      setAcking(false);
    }
  };

  // Reverse an accidental acknowledgement — confirms, then returns the
  // handoff to 'signed' so the oncoming nurse can re-acknowledge.
  const handleUnacknowledge = async () => {
    if (!latest || acking) return;
    if (!window.confirm(t('action.confirm'))) return;
    setAcking(true);
    try {
      await unacknowledge(latest._id, currentUser._id, currentUser.name);
    } catch (err) {
      console.error('Failed to reverse handoff acknowledgement:', err);
      showToast(t('nurse.handoffAcknowledgeFailedToast'), 'error');
    } finally {
      setAcking(false);
    }
  };

  const signedTime = signedDoc
    ? new Date(signedDoc.signedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '';

  // Real KPI strip — only counts we actually have. Colors are the design's
  // semantic text tints (blue / danger / danger / warning).
  const stats = [
    { icon: BedDouble, label: t('nurse.totalPatients'), value: totalPatients, color: 'var(--accent-primary)' },
    { icon: AlertCircle, label: t('nurse.criticalPatients'), value: criticalCount, color: 'var(--color-danger-text)' },
    { icon: Pill, label: t('nurse.medicationsOverdue'), value: overdueMarCount, color: 'var(--color-danger-text)' },
    { icon: Pill, label: t('nurse.medicationsDueNow'), value: dueMarCount, color: '#B35900' },
  ];

  // Previous-handoff read panel for the oncoming nurse.
  const previousPanel = (
    <section className="ehr-handoff-section">
      <div className="ehr-handoff-section-head">
        <div>
          <ClipboardCheck />
          <h3>{t('nurse.previousHandoff')}</h3>
        </div>
        {latest && latest.status === 'acknowledged' && (
          <b className="ehr-handoff-badge" data-tone="green" aria-label={t('nurse.acknowledgeHandoff')}>
            <Check className="w-3 h-3" />
          </b>
        )}
      </div>
      <div className="ehr-handoff-section-body">
        {!latest ? (
          <p className="ehr-handoff-empty">{t('nurse.noPreviousHandoff')}</p>
        ) : (
          <>
            <p className="ehr-handoff-note">
              {t('nurse.handoffFromNurse', { name: latest.outgoingNurseName, shift: shiftLabel(latest.shift), date: latest.shiftDate })}
            </p>
            {latest.notes && (
              <p className="ehr-handoff-note whitespace-pre-wrap"><strong>{latest.notes}</strong></p>
            )}
            {latest.patients.length > 0 && latest.patients.map(pt => (
              <div key={pt.patientId} className="ehr-handoff-card">
                <span className="ehr-handoff-name">{shortenPersonName(pt.patientName)}</span>
                {(pt.situation || pt.background || pt.assessment || pt.recommendation || pt.tasks?.length) ? (
                  <ul className="ehr-handoff-sbar-list">
                    {pt.situation && <li><b>{t('nurse.sbarSituation')}:</b> {pt.situation}</li>}
                    {pt.background && <li><b>{t('nurse.sbarBackground')}:</b> {pt.background}</li>}
                    {pt.assessment && <li><b>{t('nurse.sbarAssessment')}:</b> {pt.assessment}</li>}
                    {pt.recommendation && <li><b>{t('nurse.sbarRecommendation')}:</b> {pt.recommendation}</li>}
                    {pt.tasks?.length ? <li><b>{t('nurse.sbarTasks')}:</b> {pt.tasks.join('; ')}</li> : null}
                  </ul>
                ) : (
                  <p className="ehr-handoff-note">{t('nurse.noHandoverDetail')}</p>
                )}
              </div>
            ))}
            {latest.status === 'acknowledged' ? (
              <div className="flex items-center justify-between gap-2">
                <p className="ehr-handoff-note" style={{ color: 'var(--color-success-text)', fontWeight: 700 }}>
                  {t('nurse.handoffAcknowledgedBy', {
                    name: latest.acknowledgedByName ?? '',
                    time: latest.acknowledgedAt ? new Date(latest.acknowledgedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
                  })}
                </p>
                <button
                  type="button"
                  onClick={handleUnacknowledge}
                  disabled={acking}
                  className="ehr-handoff-clear"
                  title={t('action.undo')}
                >
                  <RotateCcw className="w-3 h-3" /> {t('action.undo')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleAcknowledge}
                disabled={acking}
                className="ehr-handoff-btn primary"
                style={{ width: '100%' }}
              >
                {t('nurse.acknowledgeHandoff')}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );

  const body = (
    <div className="ehr-handoff-body print-handoff">
      {/* KPI strip — real counts only */}
      <div className="ehr-handoff-stats">
        {stats.map(s => (
          <div key={s.label} className="ehr-handoff-stat">
            <s.icon style={{ color: s.color }} />
            <span>{s.label}</span>
            <b style={{ color: s.color }}>{s.value}</b>
          </div>
        ))}
      </div>

      {/* Previous shift handoff (read + acknowledge) */}
      {previousPanel}

      {/* Critical patients with per-patient SBAR editor */}
      <section className="ehr-handoff-section">
        <div className="ehr-handoff-section-head">
          <div>
            <AlertCircle style={{ color: 'var(--color-danger-text)' }} />
            <h3>{t('nurse.patientHandover')}</h3>
          </div>
          <b className="ehr-handoff-badge" data-tone={criticalCount > 0 ? 'red' : undefined}>{criticalCount}</b>
        </div>
        {criticalPatients.length > 0 && (
          <div className="ehr-handoff-section-head" style={{ minHeight: 0, padding: '8px 12px' }}>
            <ListSearch value={search} onChange={setSearch} placeholder={t('nurse.searchPatientPlaceholder')} />
          </div>
        )}
        <div className="ehr-handoff-section-body">
          {filteredCritical.length > 0 ? (
            filteredCritical.map(p => {
              const d = sbar[p._id] ?? EMPTY_SBAR;
              // Surface the latest triage pain score / GCS read-only so the
              // oncoming nurse sees a critical patient's key neuro/pain status
              // at a glance — informational, not part of handoff persistence.
              const tri = patientTriageMap.get(p._id);
              return (
                <div key={p._id} className="ehr-handoff-card">
                  <div className="ehr-handoff-card-head">
                    <div>
                      {p._demo ? (
                        <span className="ehr-handoff-name">{patientFullName(p)}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => router.push(`/patients/${p._id}?tab=sbar`)}
                          className="ehr-handoff-name"
                          title={t('nurse.viewPatientRecord')}
                        >
                          {patientFullName(p)}
                        </button>
                      )}
                      {tri?.painScore && (
                        <span className="ehr-handoff-chip">{t('nurse.painScore')} {tri.painScore}</span>
                      )}
                      {tri?.gcs && (
                        <span className="ehr-handoff-chip">{t('nurse.gcs')} {tri.gcs}</span>
                      )}
                    </div>
                    {sbarHasContent(sbar[p._id]) && (
                      <button
                        type="button"
                        onClick={() => clearSbar(p._id)}
                        className="ehr-handoff-clear"
                        title={t('action.clear')}
                      >
                        <X className="w-3 h-3" /> {t('action.clear')}
                      </button>
                    )}
                  </div>
                  <div className="ehr-handoff-grid">
                    <input value={d.situation} onChange={e => updateSbar(p._id, 'situation', e.target.value)} placeholder={t('nurse.sbarSituation')} className="ehr-handoff-input" />
                    <input value={d.background} onChange={e => updateSbar(p._id, 'background', e.target.value)} placeholder={t('nurse.sbarBackground')} className="ehr-handoff-input" />
                    <input value={d.assessment} onChange={e => updateSbar(p._id, 'assessment', e.target.value)} placeholder={t('nurse.sbarAssessment')} className="ehr-handoff-input" />
                    <input value={d.recommendation} onChange={e => updateSbar(p._id, 'recommendation', e.target.value)} placeholder={t('nurse.sbarRecommendation')} className="ehr-handoff-input" />
                  </div>
                  <textarea rows={2} value={d.tasks} onChange={e => updateSbar(p._id, 'tasks', e.target.value)} placeholder={t('nurse.sbarTasksPlaceholder')} className="ehr-handoff-input" />
                </div>
              );
            })
          ) : (
            <p className="ehr-handoff-empty">{t('nurse.noCriticalPatients')}</p>
          )}
        </div>
      </section>

      {/* Shift-wide notes */}
      <section className="ehr-handoff-section">
        <div className="ehr-handoff-section-head">
          <div>
            <FileText />
            <h3>{t('nurse.notesOutgoingNurse')}</h3>
          </div>
        </div>
        <div className="ehr-handoff-section-body">
          <textarea
            rows={4}
            placeholder={t('nurse.handoffNotesPlaceholder')}
            value={handoffNotes}
            onChange={e => setHandoffNotes(e.target.value)}
            className="ehr-handoff-input"
            style={{ marginTop: 0 }}
          />
        </div>
      </section>

      {/* Sign-off */}
      <section className="ehr-handoff-section">
        <div className="ehr-handoff-section-body">
          {signedDoc ? (
            <div className="ehr-handoff-signed">
              <Check /> {t('nurse.handoffSignedBy', { name: signedDoc.outgoingNurseName, time: signedTime })}
            </div>
          ) : (
            <div className="ehr-handoff-signoff">
              <div>
                <label className="ehr-handoff-label">{t('nurse.incomingNurse')}</label>
                <input
                  type="text"
                  value={incomingNurse}
                  onChange={e => setIncomingNurse(e.target.value)}
                  placeholder={t('nurse.incomingNursePlaceholder')}
                  className="ehr-handoff-input"
                />
              </div>
              <button
                type="button"
                onClick={handleSignOff}
                disabled={signing}
                className="ehr-handoff-btn primary"
              >
                {signing ? t('nurse.signingOff') : t('nurse.signOffComplete')}
              </button>
            </div>
          )}
          <p className="ehr-handoff-meta">
            {t('nurse.generatedBy', { name: currentUser.name, time: nowTime })} · {shiftLabel(shift)}
          </p>
        </div>
      </section>
    </div>
  );

  const header = (
    <div className="ehr-handoff-head">
      <div className="ehr-handoff-head-title">
        <FileText />
        <div>
          <h2>{t('nurse.shiftHandoffReport')}</h2>
          <p>{todayDate} · {currentUser.name}</p>
        </div>
      </div>
      <div className="ehr-handoff-head-actions">
        <button type="button" onClick={() => printElementById('shift-handoff-print')} className="ehr-handoff-btn sm">
          <Printer /> {t('action.print')}
        </button>
        {variant === 'modal' && (
          <button type="button" onClick={() => onClose?.()} className="ehr-handoff-close" aria-label={t('action.close')}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  if (variant === 'modal') {
    return (
      <Modal onClose={() => onClose?.()} width={768}>
        {/* The shift tour targets this node; it moved with the report when
            handoff stopped being a board and became this dialog. */}
        <div id="shift-handoff-print" data-tour="handoff-sbar" className="ehr-handoff-modal" role="dialog" aria-modal="true" aria-label={t('nurse.shiftHandoffReport')}>
          {header}
          {body}
        </div>
      </Modal>
    );
  }

  // variant === 'page'
  return (
    <div id="shift-handoff-print" data-tour="handoff-sbar" className="ehr-handoff-modal" style={{ flex: 1, minHeight: 0, maxHeight: 'none', border: '1px solid var(--ehr-border)' }}>
      {header}
      {body}
    </div>
  );
}
