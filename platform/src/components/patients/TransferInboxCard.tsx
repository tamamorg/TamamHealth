'use client';

/**
 * Dashboard card: internal transfers waiting on this user's decision.
 *
 * A transfer request that only appears on the patient's own chart is invisible
 * to the person who has to answer it — they have no reason to open a chart that
 * is not theirs yet. This is the surface that makes the request/accept workflow
 * actually close, rather than leaving requests to time out unseen.
 *
 * Accept is available inline because the decision is usually trivial ("yes,
 * that's my patient now"). Reject is not: it requires a reason, and collecting
 * one properly belongs on the chart where the clinical picture is in view.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTransferQueue } from '@/lib/hooks/usePatientTransfers';
import {
  describeAssignment, isTransferOverdue,
} from '@/lib/services/patient-transfer-service';
import { canDecideTransfer } from '@/lib/services/patient-transfer-permissions';
import type { PatientTransferDoc } from '@/lib/db-types';
import {
  ArrowRightLeft, ArrowRight, Check, Clock,
} from '@/components/icons/lucide';

export default function TransferInboxCard({ limit = 6 }: { limit?: number }) {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { incoming, outgoing, reload } = useTransferQueue();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const auth = currentUser ? {
    sub: currentUser._id,
    username: currentUser.username,
    role: currentUser.role,
    name: currentUser.name || currentUser.username,
    hospitalId: currentUser.hospitalId,
    orgId: currentUser.orgId,
  } : null;

  const accept = async (t: PatientTransferDoc) => {
    setBusyId(t._id);
    setError(null);
    try {
      const response = await fetch('/api/patient-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'accept', transferId: t._id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not accept the transfer');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept the transfer');
    } finally {
      setBusyId(null);
    }
  };

  // Overdue first, then oldest request first — the order in which they should
  // actually be worked.
  const rows = [...incoming].sort((a, b) => {
    const ao = isTransferOverdue(a) ? 0 : 1;
    const bo = isTransferOverdue(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.requestedAt || '').localeCompare(b.requestedAt || '');
  });

  return (
    <div className="dash-card overflow-hidden">
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-light)' }}
      >
        <h3 className="font-semibold text-sm inline-flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}>
          <ArrowRightLeft className="w-4 h-4" />
          Transfers awaiting you
          {rows.length > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded font-bold"
              style={{ background: 'rgba(217, 119, 6, 0.14)', color: '#92400E' }}>
              {rows.length}
            </span>
          )}
        </h3>
      </div>

      {rows.length === 0 ? (
        <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
          <ArrowRightLeft className="w-8 h-8 mx-auto mb-2" style={{ opacity: 0.5 }} />
          <div className="text-[12px]">No transfers are waiting on your decision.</div>
        </div>
      ) : (
        <div>
          {rows.slice(0, limit).map(t => {
            const overdue = isTransferOverdue(t);
            const decide = auth ? canDecideTransfer(auth, t) : { allowed: false };
            return (
              <div
                key={t._id}
                className={`data-row w-full ${overdue ? 'data-row--warning' : ''}`}
              >
                <div className="icon-box-sm flex-shrink-0">
                  {overdue
                    ? <Clock className="w-4 h-4" style={{ color: 'var(--color-danger-500)' }} />
                    : <ArrowRightLeft className="w-4 h-4" style={{ color: 'var(--color-warning-text)' }} />}
                </div>
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => router.push(`/patients/${t.patientId}?tab=referrals`)}
                >
                  <div className="text-sm font-semibold truncate"
                    style={{ color: 'var(--text-primary)' }}>
                    {t.patientName || 'Patient'}
                    {t.hospitalNumber ? ` · ${t.hospitalNumber}` : ''}
                  </div>
                  <div className="text-[11.5px] mt-0.5 truncate"
                    style={{ color: overdue ? 'var(--color-danger-500)' : 'var(--text-muted)' }}>
                    {overdue ? 'Overdue · ' : ''}
                    {describeAssignment(t.from)} → you · {t.reason}
                  </div>
                </button>
                {decide.allowed && (
                  <button
                    className="btn btn-primary text-[11px] inline-flex items-center gap-1 flex-shrink-0"
                    disabled={busyId === t._id}
                    onClick={() => accept(t)}
                    title="Take responsibility for this patient"
                  >
                    <Check className="w-3 h-3" />
                    {busyId === t._id ? 'Accepting…' : 'Accept'}
                  </button>
                )}
                <button
                  className="flex-shrink-0"
                  onClick={() => router.push(`/patients/${t.patientId}?tab=referrals`)}
                  aria-label="Open transfer"
                >
                  <ArrowRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
            );
          })}
          {rows.length > limit && (
            <div className="px-5 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              +{rows.length - limit} more awaiting your decision.
            </div>
          )}
        </div>
      )}

      {(outgoing.length > 0 || rows.length > 0) && (
        <div className="px-5 py-3 border-t flex flex-wrap gap-2 text-[11px]" style={{ borderColor: 'var(--border-light)', color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Transfer flow</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--gold-100, #fef3c7)' }}>{rows.length} awaiting you</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--iris-100, #e0e7ff)' }}>{outgoing.length} sent and open</span>
          <button className="underline ml-auto" onClick={() => router.push('/notifications?type=transfer')}>View all transfer alerts</button>
        </div>
      )}

      {error && (
        <div className="px-5 py-2 text-[11.5px]" style={{ color: 'var(--color-danger-500)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
