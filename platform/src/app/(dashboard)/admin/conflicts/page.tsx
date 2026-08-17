'use client';

/**
 * Admin → Conflict Reconciliation queue, restyled to the sadb-* super-admin
 * design language. Shows PouchDB revision conflicts that were flagged as
 * high/medium/low risk; admins pick a winning rev or dismiss the conflict.
 *
 * This page keeps its own multi-role guard (CONFLICT_RESOLUTION_ROLES) —
 * deliberately NOT super_admin-only — so it does not use SadbPage's guard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConflictQueueDoc } from '@/lib/db-types';
import { useAuth } from '@/lib/context';
import { apiFetch } from '@/lib/api-fetch';
import { useToast } from '@/components/Toast';
import { CONFLICT_RESOLUTION_ROLES } from '@/lib/permissions';
import {
  SadbCard, SadbChip, SadbKvRow, SadbActionButton, SadbPanelHeader,
  SadbEditorModal, SadbConfirmModal, useSadbTab, type ChipTone,
} from '@/components/admin/sadb-ui';

const STATUSES = ['pending', 'resolved', 'dismissed'] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending', resolved: 'Resolved', dismissed: 'Dismissed',
};

const RISK_CHIP: Record<ConflictQueueDoc['risk'], ChipTone> = {
  high: 'red', medium: 'yellow', low: 'neutral',
};
const RISK_LABEL: Record<ConflictQueueDoc['risk'], string> = {
  high: 'High', medium: 'Medium', low: 'Low',
};

interface ResolveTarget { id: string; rev: string }

export default function ConflictsPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [filterStatus, setFilterStatus] = useSadbTab('pending');
  const [conflicts, setConflicts] = useState<ConflictQueueDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Real per-status counts for the tab pills — three lightweight GETs against
  // the same endpoint the list itself uses, refreshed on mount and again
  // after every mutation (a conflict moves from pending into resolved or
  // dismissed). Never hard-coded.
  const [counts, setCounts] = useState<Record<Status, number | null>>({ pending: null, resolved: null, dismissed: null });

  const [resolveTarget, setResolveTarget] = useState<ResolveTarget | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);

  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [dismissNote, setDismissNote] = useState('');
  const [dismissBusy, setDismissBusy] = useState(false);

  // useSadbTab starts at its default ('pending') for the first render and
  // only overwrites it from ?tab= in an effect that runs after mount — so on
  // a `?tab=dismissed` landing, this effect's first pass fires with the stale
  // default before the second pass fires with the real tab. Both requests hit
  // an admin-scale conflict_queue table, and the server does not guarantee
  // FIFO completion, so the wrong response can arrive last and overwrite the
  // right one. requestIdRef makes only the most recently *initiated* request
  // allowed to commit state.
  const requestIdRef = useRef(0);

  const loadConflicts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/conflicts?status=${filterStatus}`);
      if (requestIdRef.current !== requestId) return;
      if (res.ok) {
        const data = await res.json();
        if (requestIdRef.current !== requestId) return;
        setConflicts(data.conflicts || []);
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error || `Failed to load conflicts (HTTP ${res.status})`;
        setConflicts([]);
        setErrorMsg(msg);
        showToast(msg, 'error');
      }
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      const msg = err instanceof Error ? err.message : 'Failed to load conflicts';
      setConflicts([]);
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [filterStatus, showToast]);

  const loadCounts = useCallback(async () => {
    try {
      const results = await Promise.all(
        STATUSES.map(s => fetch(`/api/admin/conflicts?status=${s}`).then(res => (res.ok ? res.json() : null)).catch(() => null)),
      );
      setCounts({
        pending: results[0]?.total ?? null,
        resolved: results[1]?.total ?? null,
        dismissed: results[2]?.total ?? null,
      });
    } catch {
      // Counts are a secondary signal on the tab pills — leave stale values on failure.
    }
  }, []);

  useEffect(() => { loadConflicts(); }, [loadConflicts]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const submitResolve = async () => {
    if (!resolveTarget) return;
    setResolveBusy(true);
    try {
      const res = await apiFetch(`/api/admin/conflicts/${resolveTarget.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', chosenRev: resolveTarget.rev, note: resolveNote || undefined }),
      });
      if (res.ok) {
        showToast('Conflict resolved', 'success');
        setResolveTarget(null);
        await Promise.all([loadConflicts(), loadCounts()]);
      } else {
        const body = await res.json().catch(() => ({}));
        showToast(body?.error || 'Failed to resolve conflict', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resolve conflict', 'error');
    } finally {
      setResolveBusy(false);
    }
  };

  const submitDismiss = async () => {
    if (!dismissTarget) return;
    setDismissBusy(true);
    try {
      const res = await apiFetch(`/api/admin/conflicts/${dismissTarget}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', note: dismissNote.trim() || undefined }),
      });
      if (res.ok) {
        showToast('Conflict dismissed', 'success');
        setDismissTarget(null);
        setDismissNote('');
        await Promise.all([loadConflicts(), loadCounts()]);
      } else {
        const body = await res.json().catch(() => ({}));
        showToast(body?.error || 'Failed to dismiss conflict', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to dismiss conflict', 'error');
    } finally {
      setDismissBusy(false);
    }
  };

  const allowed = !!currentUser && CONFLICT_RESOLUTION_ROLES.includes(currentUser.role);

  if (!allowed) {
    return (
      <main className="page-container page-enter sadb-scope">
        <div className="sadb-page">
          <SadbCard title="Conflict reconciliation">
            <p className="sadb-empty">Access restricted to administrators.</p>
          </SadbCard>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">
        <SadbPanelHeader
          title="Conflict reconciliation"
          note="High-risk clinical data (allergies, referrals, discharge status) flagged for human review after a replication conflict."
        />

        <div className="flex gap-1" role="tablist" aria-label="Conflict status" data-tour="admin-conflicts-tabs">
          {STATUSES.map(s => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={filterStatus === s}
              className={`sadb-pill${filterStatus === s ? ' is-active' : ''}`}
              onClick={() => setFilterStatus(s)}
            >
              {STATUS_LABEL[s]} ({counts[s] ?? '…'})
            </button>
          ))}
        </div>

        {errorMsg && (
          <SadbCard>
            <div role="alert" className="sadb-queue-row" style={{ cursor: 'default' }}>
              <SadbChip tone="yellow">Error</SadbChip>
              <span className="sadb-queue-copy">
                <span className="sadb-queue-title">{errorMsg}</span>
              </span>
            </div>
          </SadbCard>
        )}

        {loading ? (
          <SadbCard><p className="sadb-empty">Loading…</p></SadbCard>
        ) : conflicts.length === 0 ? (
          <SadbCard><p className="sadb-empty">No {STATUS_LABEL[filterStatus as Status].toLowerCase()} conflicts.</p></SadbCard>
        ) : (
          <div className="flex flex-col gap-3">
            {conflicts.map(c => {
              const rowBusy = (resolveBusy && resolveTarget?.id === c._id) || (dismissBusy && dismissTarget === c._id);
              return (
                <SadbCard
                  key={c._id}
                  title={c.resourceType}
                  meta={<span style={{ fontFamily: 'var(--font-platform-mono)' }}>{c.resourceId}</span>}
                  action={<SadbChip tone={RISK_CHIP[c.risk]}>{RISK_LABEL[c.risk]}</SadbChip>}
                >
                  <SadbKvRow
                    label="Default winner"
                    value={<span style={{ fontFamily: 'var(--font-platform-mono)' }}>{c.winningRev}</span>}
                  />
                  <div className="sadb-setting-row">
                    <div className="sadb-setting-copy">
                      <b className="sadb-setting-label">Losing revisions</b>
                      <span className="sadb-setting-sub">
                        {c.losingRevs.map(r => (
                          <span key={r} style={{ fontFamily: 'var(--font-platform-mono)', marginRight: 8 }}>{r}</span>
                        ))}
                      </span>
                    </div>
                  </div>

                  {c.status !== 'pending' && (
                    <p className="sadb-setting-sub" style={{ padding: '10px 16px' }}>
                      {c.status === 'resolved' ? 'Resolved' : 'Dismissed'} by {c.resolvedBy || 'unknown'} on {c.resolvedAt?.slice(0, 16).replace('T', ' ') ?? ''}
                      {c.resolvedRev && <> → kept <span style={{ fontFamily: 'var(--font-platform-mono)' }}>{c.resolvedRev}</span></>}
                      {c.resolutionNote && <> — &ldquo;{c.resolutionNote}&rdquo;</>}
                    </p>
                  )}

                  {c.status === 'pending' && (
                    <div className="sadb-setting-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={rowBusy}
                        onClick={() => { setResolveTarget({ id: c._id, rev: c.winningRev }); setResolveNote(''); }}
                      >
                        Keep winner
                      </button>
                      {c.losingRevs.map(rev => (
                        <SadbActionButton
                          key={rev}
                          disabled={rowBusy}
                          onClick={() => { setResolveTarget({ id: c._id, rev }); setResolveNote(''); }}
                        >
                          Use {rev.slice(0, 6)}…
                        </SadbActionButton>
                      ))}
                      <SadbActionButton danger disabled={rowBusy} onClick={() => setDismissTarget(c._id)}>
                        Dismiss
                      </SadbActionButton>
                    </div>
                  )}
                </SadbCard>
              );
            })}
          </div>
        )}
      </div>

      {resolveTarget && (
        <SadbEditorModal
          title="Resolution note"
          sub={`Keep revision ${resolveTarget.rev.slice(0, 8)}… as the resolved version.`}
          value={resolveNote}
          onChange={setResolveNote}
          onCancel={() => setResolveTarget(null)}
          onApply={submitResolve}
          applyLabel="Resolve"
          multiline
          busy={resolveBusy}
        />
      )}

      {dismissTarget && (
        <SadbConfirmModal
          title="Dismiss conflict"
          body="Dismissing removes this conflict from the pending queue without choosing a winning revision. It is not deleted — it stays in history as dismissed."
          confirmLabel="Dismiss"
          onCancel={() => { setDismissTarget(null); setDismissNote(''); }}
          onConfirm={submitDismiss}
          busy={dismissBusy}
          noteValue={dismissNote}
          onNoteChange={setDismissNote}
          notePlaceholder="Reason for dismissing (optional)"
        />
      )}
    </main>
  );
}
