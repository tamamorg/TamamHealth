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
import InlineBanner from '@/components/overlay/InlineBanner';
import Select from '@/components/Select';
import '@/components/admin/admin-pages.css';
import { useTranslation } from '@/lib/i18n/useTranslation';
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
  pending: 'billing.ovPending', resolved: 'conflicts.actionResolved', dismissed: 'conflicts.actionDismissed',
};

const RISK_CHIP: Record<ConflictQueueDoc['risk'], ChipTone> = {
  high: 'red', medium: 'yellow', low: 'neutral',
};
const RISK_LABEL: Record<ConflictQueueDoc['risk'], string> = {
  high: 'epidemic.severityHigh', medium: 'syncConflicts.riskFilter_medium', low: 'epidemic.severityLow',
};

interface ResolveTarget { id: string; rev: string }

// Mirrors the resolve/dismiss route (POST /api/admin/conflicts/:id): the
// records officer (hrio) may open the queue but not decide clinical content.
const CONFLICT_DECIDER_ROLES = ['super_admin', 'org_admin', 'medical_superintendent'];

/** Translation key for a refused resolve/dismiss, by the route's status code. */
function conflictErrorKey(status: number): string {
  switch (status) {
    case 403: return 'conflicts.errForbidden';
    case 404: return 'conflicts.errNotFound';
    case 409: return 'conflicts.errStale';
    case 422: return 'conflicts.errUnsupported';
    default: return 'conflicts.errGeneric';
  }
}

export default function ConflictsPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();

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
        setConflicts([]);
        setErrorMsg(t('conflicts.errLoad'));
      }
    } catch {
      if (requestIdRef.current !== requestId) return;
      setConflicts([]);
      setErrorMsg(t('conflicts.errLoad'));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [filterStatus, t]);

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
        showToast(t('conflicts.toastResolved'), 'success');
        setResolveTarget(null);
        await Promise.all([loadConflicts(), loadCounts()]);
      } else {
        // The row stays pending. A 409 means the chosen revision is no longer a
        // live leaf, so reload the queue to show the row as it is now.
        showToast(t(conflictErrorKey(res.status)), 'error');
        if (res.status < 500) setResolveTarget(null);
        if (res.status === 409) await Promise.all([loadConflicts(), loadCounts()]);
      }
    } catch (err) {
      console.error('Failed to resolve conflict', err);
      showToast(t('conflicts.errGeneric'), 'error');
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
        showToast(t('conflicts.toastDismissed'), 'success');
        setDismissTarget(null);
        setDismissNote('');
        await Promise.all([loadConflicts(), loadCounts()]);
      } else {
        showToast(t(conflictErrorKey(res.status)), 'error');
        if (res.status < 500) setDismissTarget(null);
        if (res.status === 409) await Promise.all([loadConflicts(), loadCounts()]);
      }
    } catch (err) {
      console.error('Failed to dismiss conflict', err);
      showToast(t('conflicts.errGeneric'), 'error');
    } finally {
      setDismissBusy(false);
    }
  };

  const allowed = !!currentUser && CONFLICT_RESOLUTION_ROLES.includes(currentUser.role);
  const canDecide = !!currentUser && CONFLICT_DECIDER_ROLES.includes(currentUser.role);

  if (!allowed) {
    return (
      <main className="page-container page-enter sadb-scope">
        <div className="sadb-page">
          <SadbCard title={t('ui.conflictReconciliation')}>
            <p className="sadb-empty">{t('conflicts.accessRestricted')}</p>
          </SadbCard>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">
        <SadbPanelHeader
          title={t('ui.conflictReconciliation')}
          note={t('adminMgmt.conflictsNote')}
        />

        <div className="adm-fields" data-tour="admin-conflicts-tabs">
          <label className="adm-field">
            <span className="adm-field-label">{t('conflicts.showLabel')}</span>
            <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label={t('conflicts.showLabel')}>
              {STATUSES.map(s => (
                <option key={s} value={s}>{t(STATUS_LABEL[s])} ({counts[s] ?? '…'})</option>
              ))}
            </Select>
          </label>
        </div>

        {errorMsg && (
          <InlineBanner
            tone="danger"
            title={errorMsg}
            action={{ label: t('management.retry'), onClick: () => { void loadConflicts(); } }}
          />
        )}

        {loading ? (
          <SadbCard><p className="sadb-empty">{t('admin.loading')}</p></SadbCard>
        ) : conflicts.length === 0 ? (
          <SadbCard><p className="sadb-empty">{t('action.no')} {t(STATUS_LABEL[filterStatus as Status]).toLowerCase()} {t('ui.conflicts')}</p></SadbCard>
        ) : (
          <div className="flex flex-col gap-3">
            {conflicts.map(c => {
              const rowBusy = (resolveBusy && resolveTarget?.id === c._id) || (dismissBusy && dismissTarget === c._id);
              return (
                <SadbCard
                  key={c._id}
                  title={c.resourceType}
                  meta={<span className="adm-mono">{c.resourceId}</span>}
                  action={<SadbChip tone={RISK_CHIP[c.risk]}>{t(RISK_LABEL[c.risk])}</SadbChip>}
                >
                  <SadbKvRow
                    label={t('ui.defaultWinner')}
                    value={<span className="adm-mono">{c.winningRev}</span>}
                  />
                  <div className="sadb-setting-row">
                    <div className="sadb-setting-copy">
                      <b className="sadb-setting-label">{t('ui.losingRevisions')}</b>
                      <span className="sadb-setting-sub">
                        {c.losingRevs.map(r => (
                          <span key={r} className="adm-mono" style={{ marginInlineEnd: 8 }}>{r}</span>
                        ))}
                      </span>
                    </div>
                  </div>

                  {c.status !== 'pending' && (
                    <p className="sadb-setting-sub" style={{ padding: '10px 16px' }}>
                      {t('adminMgmt.conflictClosedBy', { status: t(STATUS_LABEL[c.status as Status]), who: c.resolvedBy || t('transfers.unknown'), when: c.resolvedAt?.slice(0, 16).replace('T', ' ') ?? '' })}
                      {c.resolvedRev && <> {t('ui.kept')} <span className="adm-mono">{c.resolvedRev}</span></>}
                      {c.resolutionNote && <> — &ldquo;{c.resolutionNote}&rdquo;</>}
                    </p>
                  )}

                  {c.status === 'pending' && !canDecide && (
                    <p className="sadb-setting-sub" style={{ padding: '10px 16px' }}>{t('conflicts.readOnlyNote')}</p>
                  )}

                  {c.status === 'pending' && canDecide && (
                    <div className="sadb-setting-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={rowBusy}
                        onClick={() => { setResolveTarget({ id: c._id, rev: c.winningRev }); setResolveNote(''); }}
                      >
                        {t('conflicts.keepWinner')}
                      </button>
                      {c.losingRevs.map(rev => (
                        <SadbActionButton
                          key={rev}
                          disabled={rowBusy}
                          onClick={() => { setResolveTarget({ id: c._id, rev }); setResolveNote(''); }}
                        >
                          {t('ui.use')} {rev.slice(0, 6)}…
                        </SadbActionButton>
                      ))}
                      <SadbActionButton danger disabled={rowBusy} onClick={() => setDismissTarget(c._id)}>
                        {t('action.dismiss')}
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
          title={t('ui.resolutionNote')}
          sub={t('adminMgmt.keepRevisionSub', { rev: resolveTarget.rev.slice(0, 8) })}
          value={resolveNote}
          onChange={setResolveNote}
          onCancel={() => setResolveTarget(null)}
          onApply={submitResolve}
          applyLabel={t('issues.action.resolve')}
          multiline
          busy={resolveBusy}
        />
      )}

      {dismissTarget && (
        <SadbConfirmModal
          title={t('ui.dismissConflict')}
          body={t('adminMgmt.dismissConflictBody')}
          confirmLabel={t('action.dismiss')}
          onCancel={() => { setDismissTarget(null); setDismissNote(''); }}
          onConfirm={submitDismiss}
          busy={dismissBusy}
          noteValue={dismissNote}
          onNoteChange={setDismissNote}
          notePlaceholder={t('adminMgmt.dismissReasonOptional')}
        />
      )}
    </main>
  );
}
