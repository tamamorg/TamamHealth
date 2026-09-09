'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EncounterDoc } from '@/lib/db-types';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { CLINICIANS, NURSING_AND_CLINICIANS } from '@/lib/sync/write-permissions';
import { ensurePostConsultHandoff, getHandoffEncounter, getHandoffQueue, updateHandoff, type HandoffAction } from '../services/handoff-service';
import type { PostConsultTask } from '../types';
import { postConsultReady } from '../types';
import { currentPlanRevision } from '../services/plan-service';
import { isTerminal } from '@/lib/clinical-flow/encounter-journey';
import './post-consult.css';

export default function PostConsultPanel({ encounterId, patientId, embedded = false }: { encounterId?: string; patientId?: string; embedded?: boolean }) {
  const scope = useDataScope();
  const { t } = useTranslation();
  const [rows, setRows] = useState<EncounterDoc[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    async function refresh() {
      try {
        const docs = encounterId ? [await getHandoffEncounter(encounterId, scope!)] : await getHandoffQueue(scope!);
        if (!cancelled) { setRows(docs.filter(d => (!patientId || d.patientId === patientId) && (d.postConsult || encounterId))); setError(false); }
      } catch { if (!cancelled) { setRows([]); setError(true); } }
      finally { if (!cancelled) setLoading(false); }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [scope, encounterId, patientId, revision]);
  // Keep an empty queue out of the dashboard; pending work and failures still
  // surface here, and polling continues so new handoffs appear automatically.
  if (!error && !rows.length) return null;
  return <section id="post-consult" className="ehr-post-consult" style={embedded ? { marginBottom: 16 } : { padding: 16, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 8 }}>
    <h2>{t('postConsult.title')}</h2>
    <p>{t('postConsult.help')}</p>
    {error ? <p role="alert">{t('postConsult.error')}</p> : loading ? <p role="status">{t('postConsult.loading')}</p> : !rows.length ? <p>{t('postConsult.empty')}</p> : rows.map(row => row.postConsult
      ? <HandoffCard key={row._id} encounter={row} onChanged={() => setRevision(r => r + 1)} />
      : scope && CLINICIANS.includes(scope.role) && <button key={row._id} type="button" className="bl-btn bl-btn--outline" onClick={() => {
        void ensurePostConsultHandoff(row._id, scope).then(() => setRevision(r => r + 1)).catch(() => setError(true));
      }}>{t('postConsult.start')}</button>)}
  </section>;
}

function HandoffCard({ encounter, onChanged }: { encounter: EncounterDoc; onChanged: () => void }) {
  const scope = useDataScope(); const { t } = useTranslation();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [reason, setReason] = useState('');
  const [recipient, setRecipient] = useState('');
  const [planChanged, setPlanChanged] = useState(false);
  const { users } = useUsers(); const { currentUser } = useAuth();
  const staff = currentUser ? [currentUser, ...users.filter(u => u._id !== currentUser._id)] : users;
  const staffName = (id?: string) => staff.find(u => u._id === id)?.name || id || t('postConsult.unclaimed');
  const h = encounter.postConsult!;
  useEffect(() => {
    let active = true;
    if (scope && !isTerminal(encounter.status)) void currentPlanRevision(encounter, scope)
      .then(plan => { if (active) setPlanChanged(!!(h.reviewedPlan || h.bypass || h.tasks.some(task => task.status !== 'pending')) && h.reviewedPlan !== plan); })
      .catch(() => { if (active) { setPlanChanged(true); setError(true); } });
    return () => { active = false; };
  }, [encounter, h, scope]);
  async function save(action: HandoffAction) {
    if (!scope || !encounter._rev) return;
    setBusy(true); setError(false);
    try { await updateHandoff(encounter._id, encounter._rev, action, scope); onChanged(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  const canWork = !!scope && NURSING_AND_CLINICIANS.includes(scope.role);
  const canManage = canWork && (h.ownerId === scope?.userId || !!scope && CLINICIANS.includes(scope.role));
  return <article className="ehr-post-consult-visit" aria-busy={busy}>
    <header className="ehr-post-consult-heading">
      <h3><Link href={`/patients/${encounter.patientId}`}>{encounter.patientName}</Link></h3>
      <span className="ehr-post-consult-status">{t(planChanged ? 'postConsult.changed' : postConsultReady(h) ? 'postConsult.reviewed' : 'postConsult.status.pending')}</span>
    </header>
    <p>{t('postConsult.owner')}: <strong>{staffName(h.ownerId)}</strong></p>
    <p>{t('postConsult.progress', { completed: h.tasks.filter(task => task.status === 'done').length, total: h.tasks.length })}</p>
    <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {(['notes', 'medications', 'labs', 'procedures'] as const).map(tab => <Link key={tab} href={`/patients/${encounter.patientId}?tab=${tab === 'medications' ? 'prescriptions' : tab}`}>{t(`postConsult.link.${tab}`)}</Link>)}
    </nav>
    {planChanged && <div className="ehr-post-consult-warning" role="status">
      <p>{t('postConsult.changedHelp')}</p>
      {canManage && <button type="button" className="bl-btn bl-btn--outline" disabled={busy} onClick={() => void save({ type: 'reopen', reason: t('postConsult.changed') })}>{t('postConsult.reopen')}</button>}
    </div>}
    {h.bypass ? <p>{t('postConsult.bypassed')}: {h.bypass.reason}</p> : <>
      {canWork && (!h.ownerId || h.ownerId === scope?.userId && !h.acceptedAt) && <button type="button" className="bl-btn bl-btn--outline" disabled={busy} onClick={() => void save({ type: 'accept' })}>{t('postConsult.accept')}</button>}
      {canManage && <details className="ehr-post-consult-transfer">
        <summary>{t('postConsult.transfer')}</summary>
        <p>{t('postConsult.transferHelp')}</p>
        <label>{t('postConsult.selectOwner')}<select value={recipient} onChange={e => setRecipient(e.target.value)} disabled={busy}>
          <option value="">{t('postConsult.selectOwner')}</option>
          {staff.filter(u => u._id !== h.ownerId && NURSING_AND_CLINICIANS.includes(u.role)).map(u => <option key={u._id} value={u._id}>{u.name || u.username}</option>)}
        </select></label>
        <label>{t('postConsult.reason')}<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
        <button type="button" className="bl-btn bl-btn--outline" disabled={busy || !recipient || !reason.trim()} onClick={() => void save({ type: 'transfer', ownerId: recipient, reason })}>{t('postConsult.transfer')}</button>
      </details>}
      {h.tasks.map(task => <TaskEditor key={`${h.createdAt}-${task.kind}`} task={task} disabled={busy || planChanged || !canWork || (!h.acceptedAt && h.ownerId === scope?.userId) || (h.ownerId !== scope?.userId && !(task.status === 'deferred' && task.ownerId === scope?.userId))} save={save} />)}
      {scope && CLINICIANS.includes(scope.role) && h.tasks.every(task => task.status === 'pending') && <details>
        <summary>{t('postConsult.noTasks')}</summary>
        <label>{t('postConsult.reason')}<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
        <button type="button" className="bl-btn bl-btn--outline" disabled={busy || !reason.trim()} onClick={() => void save({ type: 'bypass', reason })}>{t('postConsult.confirm')}</button>
      </details>}
    </>}
    {!!h.transfers?.length && <p>{t('postConsult.lastTransfer')}: {staffName(h.transfers.at(-1)?.from)} → {staffName(h.transfers.at(-1)?.to)}</p>}
    {!!h.history?.length && <details>
      <summary>{t('postConsult.history')}</summary>
      {h.history.map((entry, index) => <div key={`${entry.at}-${index}`}>
        <p><strong>{staffName(entry.actorId)}</strong> — {new Date(entry.at).toLocaleString()}</p>
        <p>{entry.reason}</p>
        {entry.handoff.bypass && <p>{entry.handoff.bypass.reason}</p>}
        {entry.handoff.tasks.map(task => <p key={task.kind}>{t(`postConsult.task.${task.kind}`)}: {t(`postConsult.status.${task.status}`)}{task.note ? ` — ${task.note}` : ''}</p>)}
      </div>)}
    </details>}
    {error && <p role="alert">{t('postConsult.error')}</p>}
  </article>;
}
function TaskEditor({ task, disabled, save }: { task: PostConsultTask; disabled: boolean; save: (action: HandoffAction) => Promise<void> }) {
  const { t } = useTranslation(); const { users } = useUsers(!disabled);
  const { currentUser } = useAuth();
  const staff = currentUser ? [{ ...currentUser, isActive: true }, ...users.filter(u => u._id !== currentUser._id)] : users;
  const [note, setNote] = useState(''); const [defer, setDefer] = useState(false); const [owner, setOwner] = useState(''); const [due, setDue] = useState('');
  return <details style={{ marginTop: 12 }}>
    <summary>{t(`postConsult.task.${task.kind}`)} — {t(`postConsult.status.${task.status}`)}</summary>
    {task.note && <p>{task.note}</p>}
    {task.dueAt && <p>{t('postConsult.due')}: {new Date(task.dueAt).toLocaleString()} · {staff.find(u => u._id === task.ownerId)?.name || task.ownerId}</p>}
    {!disabled && <fieldset disabled={disabled}>
      <label>{t('postConsult.evidence')}<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label>
      <label><input type="checkbox" checked={defer} onChange={e => setDefer(e.target.checked)} /> {t('postConsult.defer')}</label>
      {defer && <>
        <label>{t('postConsult.owner')}<select value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">{t('postConsult.selectOwner')}</option>
          {staff.filter(u => u.isActive && NURSING_AND_CLINICIANS.includes(u.role)).map(u => <option key={u._id} value={u._id}>{u.name || u.username}</option>)}
        </select></label>
        <label>{t('postConsult.due')}<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label>
      </>}
      <button type="button" className="bl-btn bl-btn--outline" disabled={!note.trim() || (defer && (!owner || !due || !Number.isFinite(Date.parse(due))))}
        onClick={() => void save({ type: 'task', kind: task.kind, status: defer ? 'deferred' : 'done', note, ownerId: owner, dueAt: due ? new Date(due).toISOString() : undefined })}>{t('postConsult.save')}</button>
    </fieldset>}
  </details>;
}
