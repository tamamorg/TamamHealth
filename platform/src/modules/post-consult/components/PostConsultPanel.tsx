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
import './post-consult.css';

export default function PostConsultPanel({ encounterId }: { encounterId?: string }) {
  const scope = useDataScope();
  const { t } = useTranslation();
  const [rows, setRows] = useState<EncounterDoc[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    async function refresh() {
      try {
        const docs = encounterId ? [await getHandoffEncounter(encounterId, scope!)] : await getHandoffQueue(scope!);
        if (!cancelled) { setRows(docs.filter(d => d.postConsult || encounterId)); setError(false); }
      } catch { if (!cancelled) { setRows([]); setError(true); } }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [scope, encounterId, revision]);
  return <section className="ehr-post-consult" style={{ padding: 16, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 8 }}>
    <h2>{t('postConsult.title')}</h2>
    <p>{t('postConsult.help')}</p>
    {error ? <p role="alert">{t('postConsult.error')}</p> : !rows.length ? <p>{t('postConsult.empty')}</p> : rows.map(row => row.postConsult
      ? <HandoffCard key={row._id} encounter={row} onChanged={() => setRevision(r => r + 1)} />
      : scope && CLINICIANS.includes(scope.role) && <button key={row._id} type="button" className="bl-btn bl-btn--outline" onClick={() => {
        void ensurePostConsultHandoff(row._id, scope).then(() => setRevision(r => r + 1)).catch(() => setError(true));
      }}>{t('postConsult.start')}</button>)}
  </section>;
}

function HandoffCard({ encounter, onChanged }: { encounter: EncounterDoc; onChanged: () => void }) {
  const scope = useDataScope(); const { t } = useTranslation();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [reason, setReason] = useState('');
  const h = encounter.postConsult!;
  async function save(action: HandoffAction) {
    if (!scope || !encounter._rev) return;
    setBusy(true); setError(false);
    try { await updateHandoff(encounter._id, encounter._rev, action, scope); onChanged(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  const canWork = !!scope && NURSING_AND_CLINICIANS.includes(scope.role);
  return <article style={{ padding: '12px 0', borderTop: '1px solid var(--border-light)' }}>
    <h3><Link href={`/patients/${encounter.patientId}`}>{encounter.patientName}</Link></h3>
    <p>{t('postConsult.owner')}: {h.ownerId || t('postConsult.unclaimed')}</p>
    <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {(['notes', 'medications', 'labs', 'procedures'] as const).map(tab => <Link key={tab} href={`/patients/${encounter.patientId}?tab=${tab === 'medications' ? 'prescriptions' : tab}`}>{t(`postConsult.link.${tab}`)}</Link>)}
    </nav>
    {h.bypass ? <p>{t('postConsult.bypassed')}: {h.bypass.reason}</p> : <>
      {canWork && !h.ownerId && <button type="button" className="bl-btn bl-btn--outline" disabled={busy} onClick={() => void save({ type: 'accept' })}>{t('postConsult.accept')}</button>}
      {h.tasks.map(task => <TaskEditor key={task.kind} task={task} disabled={busy || !canWork || (h.ownerId !== scope?.userId && !(task.status === 'deferred' && task.ownerId === scope?.userId))} save={save} />)}
      {scope && CLINICIANS.includes(scope.role) && h.tasks.every(task => task.status === 'pending') && <details>
        <summary>{t('postConsult.noTasks')}</summary>
        <label>{t('postConsult.reason')}<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
        <button type="button" className="bl-btn bl-btn--outline" disabled={busy || !reason.trim()} onClick={() => void save({ type: 'bypass', reason })}>{t('postConsult.confirm')}</button>
      </details>}
    </>}
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
    {task.dueAt && <p>{t('postConsult.due')}: {task.dueAt} · {task.ownerId}</p>}
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
