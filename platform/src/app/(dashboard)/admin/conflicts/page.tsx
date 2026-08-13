'use client';

/**
 * Admin → Conflict Reconciliation queue.
 * Shows PouchDB revision conflicts that were flagged as high/medium risk.
 * Admins pick a winning rev or dismiss the conflict.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ConflictQueueDoc } from '@/lib/db-types';
import { useAuth } from '@/lib/context';
import { apiFetch } from '@/lib/api-fetch';
import { useToast } from '@/components/Toast';
import { CONFLICT_RESOLUTION_ROLES } from '@/lib/permissions';
import { useTranslation } from '@/lib/i18n/useTranslation';

const RISK_STYLES: Record<ConflictQueueDoc['risk'], { bg: string; fg: string; border: string; label: string }> = {
  high:   { bg: 'rgba(229,46,66,0.08)',  fg: 'var(--color-danger-text)', border: 'rgba(229,46,66,0.25)', label: 'HIGH' },
  medium: { bg: 'rgba(228,168,75,0.12)', fg: '#8A5C0F', border: 'rgba(228,168,75,0.35)', label: 'MEDIUM' },
  low:    { bg: 'rgba(33,145,208,0.08)', fg: 'var(--accent-hover)', border: 'rgba(33,145,208,0.25)', label: 'LOW' },
};

export default function ConflictsPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<ConflictQueueDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'resolved' | 'dismissed'>('pending');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadConflicts = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/conflicts?status=${filterStatus}`);
      if (res.ok) {
        const data = await res.json();
        setConflicts(data.conflicts || []);
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error || t('conflicts.errorLoadFailedHttp', { status: res.status });
        setConflicts([]);
        setErrorMsg(msg);
        showToast(msg, 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('syncConflicts.errorLoadFailed');
      setConflicts([]);
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, showToast, t]);

  useEffect(() => { loadConflicts(); }, [loadConflicts]);

  // We keep window.prompt for the note input — replacing it requires a real
  // modal dialog which is out of scope for this pass. The user-facing wins
  // here are surfacing success/failure as toasts instead of alert(), which
  // also makes failures non-blocking and accessible.
  const handleResolve = async (id: string, chosenRev: string) => {
    const note = window.prompt(t('conflicts.promptResolutionNote'));
    if (note === null) return;
    try {
      const res = await apiFetch(`/api/admin/conflicts/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', chosenRev, note: note || undefined }),
      });
      if (res.ok) {
        showToast(t('conflicts.toastResolved'), 'success');
        await loadConflicts();
      } else {
        const body = await res.json().catch(() => ({}));
        showToast(body?.error || t('conflicts.toastResolveFailed'), 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('conflicts.toastResolveFailed'), 'error');
    }
  };

  const handleDismiss = async (id: string) => {
    if (!window.confirm(t('conflicts.confirmDismiss'))) return;
    const note = window.prompt(t('conflicts.promptDismissReason'));
    try {
      const res = await apiFetch(`/api/admin/conflicts/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', note: note || undefined }),
      });
      if (res.ok) {
        showToast(t('conflicts.toastDismissed'), 'success');
        await loadConflicts();
      } else {
        const body = await res.json().catch(() => ({}));
        showToast(body?.error || t('conflicts.toastDismissFailed'), 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('conflicts.toastDismissFailed'), 'error');
    }
  };

  const allowed = !!currentUser && CONFLICT_RESOLUTION_ROLES.includes(currentUser.role);

  if (!allowed) {
    return (
      <>
        <main className="page-container page-enter admin-detail-page">
          <section className="admin-detail-empty">
            <h1>{t('conflicts.title')}</h1>
            <p>{t('conflicts.accessRestricted')}</p>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <main className="page-container page-enter admin-detail-page">
        <section className="admin-detail-header">
          <div>
            <p>{t('conflicts.eyebrow')}</p>
            <h1>{t('conflicts.title')}</h1>
            <span>{t('conflicts.subtitle')}</span>
          </div>
          <div className="admin-detail-tabs" role="tablist" aria-label="Conflict status">
            {(['pending', 'resolved', 'dismissed'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={filterStatus === s}
                className={filterStatus === s ? 'active' : undefined}
                onClick={() => setFilterStatus(s)}
              >
                {t(`conflicts.status_${s}`)}
              </button>
            ))}
          </div>
        </section>

      {errorMsg && (
        <div
          role="alert"
          className="admin-detail-alert"
        >
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="admin-detail-empty">{t('syncConflicts.loading')}</div>
      ) : conflicts.length === 0 ? (
        <div className="admin-detail-empty">
          {t('conflicts.emptyState', { status: t(`conflicts.status_${filterStatus}`) })}
        </div>
      ) : (
        <div className="admin-conflict-list">
          {conflicts.map((c) => {
            const risk = RISK_STYLES[c.risk];
            return (
              <article key={c._id} className="admin-conflict-card">
                <div className="admin-conflict-card-grid">
                  <div className="admin-conflict-body">
                    <div className="admin-conflict-meta">
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                        padding: '3px 10px', borderRadius: 999,
                        background: risk.bg, color: risk.fg, border: `1px solid ${risk.border}`,
                      }}>{t(`conflicts.risk_${c.risk}`)}</span>
                      <span className="admin-conflict-resource">
                        {c.resourceType}
                      </span>
                      <span className="admin-conflict-id">
                        {c.resourceId}
                      </span>
                    </div>
                    <div className="admin-conflict-line">
                      {t('conflicts.defaultWinner')} <span style={{ fontFamily: 'var(--font-platform-mono)', color: 'var(--text-primary)' }}>{c.winningRev}</span>
                    </div>
                    <div className="admin-conflict-line">
                      {t('conflicts.losingRevisions')} {c.losingRevs.map((r) => (
                        <span key={r} style={{ fontFamily: 'var(--font-platform-mono)', color: 'var(--text-primary)', marginRight: 8 }}>{r}</span>
                      ))}
                    </div>
                    {c.status !== 'pending' && (
                      <div className="admin-conflict-resolution">
                        {t('conflicts.resolvedBy', {
                          action: c.status === 'resolved' ? t('conflicts.actionResolved') : t('conflicts.actionDismissed'),
                          user: c.resolvedBy || t('syncConflicts.unknownUser'),
                          date: c.resolvedAt?.slice(0, 16).replace('T', ' ') ?? '',
                        })}
                        {c.resolvedRev && <> → {t('conflicts.kept')} <span style={{ fontFamily: 'var(--font-platform-mono)' }}>{c.resolvedRev}</span></>}
                        {c.resolutionNote && <> — “{c.resolutionNote}”</>}
                      </div>
                    )}
                  </div>
                  {c.status === 'pending' && (
                    <div className="admin-conflict-actions">
                      <button
                        type="button"
                        onClick={() => handleResolve(c._id, c.winningRev)}
                        className="primary"
                      >
                        {t('conflicts.keepWinner')}
                      </button>
                      {c.losingRevs.map((rev) => (
                        <button
                          key={rev}
                          type="button"
                          onClick={() => handleResolve(c._id, rev)}
                        >
                          {t('conflicts.useRev', { rev: rev.slice(0, 6) })}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handleDismiss(c._id)}
                      >
                        {t('syncConflicts.dismissButton')}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      </main>
    </>
  );
}
