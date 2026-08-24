'use client';

import EhrPageTitle from '@/components/ehr/EhrPageTitle';

/**
 * Patient transfers — the full queue, as a page.
 *
 * This was a card on the facility and superintendent dashboards. A card can
 * only ever show the first handful of rows, has nowhere to put a search or a
 * filter, and disappears entirely for anyone whose dashboard didn't happen to
 * include it — so the request/accept workflow had no home of its own. It now
 * reads like the patient registry: same list surface, same row language, one
 * column head that stays put, and a tab for each direction the work flows.
 *
 * Accept is inline because the decision is usually trivial ("yes, that's my
 * patient now"). Reject is not: it requires a reason, and collecting one
 * properly belongs on the chart where the clinical picture is in view — so the
 * row opens there instead.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTransferQueue } from '@/lib/hooks/usePatientTransfers';
import {
  describeAssignment, isTransferOverdue,
} from '@/lib/services/patient-transfer-service';
import { canDecideTransfer } from '@/lib/services/patient-transfer-permissions';
import type { PatientTransferDoc } from '@/lib/db-types';
import { ArrowRightLeft, ArrowRight, Check, Clock } from '@/components/icons/lucide';

type Tab = 'incoming' | 'outgoing';

/** Short, readable day for the list's time column. */
function formatWhen(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name?: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  requested: { bg: 'rgba(230, 114, 0, 0.14)', fg: 'var(--color-warning-text)' },
  accepted: { bg: 'rgba(10, 110, 74, 0.14)', fg: 'var(--color-success-text)' },
  rejected: { bg: 'rgba(224, 49, 39, 0.14)', fg: 'var(--color-danger-500)' },
  withdrawn: { bg: 'var(--overlay-subtle)', fg: 'var(--text-muted)' },
  expired: { bg: 'var(--overlay-subtle)', fg: 'var(--text-muted)' },
};

export default function TransfersPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { incoming, outgoing, loading, reload } = useTransferQueue();
  const [tab, setTab] = useState<Tab>('incoming');
  const [search, setSearch] = useState('');
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

  // Overdue first, then oldest request first — the order they should be worked.
  const sortForWork = (rows: PatientTransferDoc[]) => [...rows].sort((a, b) => {
    const ao = isTransferOverdue(a) ? 0 : 1;
    const bo = isTransferOverdue(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.requestedAt || '').localeCompare(b.requestedAt || '');
  });

  const rows = useMemo(() => {
    const base = sortForWork(tab === 'incoming' ? incoming : outgoing);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    const terms = q.split(/\s+/);
    return base.filter(t => {
      const hay = [
        t.patientName, t.hospitalNumber, t.reason,
        describeAssignment(t.from), describeAssignment(t.to), t.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return terms.every(term => hay.includes(term));
    });
  }, [tab, incoming, outgoing, search]);

  // Wrapped, not passed by reference: `isTransferOverdue(t, now?)` would
  // otherwise receive Array#filter's index as its `now` argument.
  const overdueCount = incoming.filter(t => isTransferOverdue(t)).length;

  const openChart = (t: PatientTransferDoc) =>
    router.push(`/patients/${t.patientId}?tab=referrals`);

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>

        {/* ── Toolbar: title, counts, tabs, search ── */}
        <div className="px-4 pt-4 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
            <EhrPageTitle>Patient transfers</EhrPageTitle>
            <div className="flex items-center gap-3 flex-wrap justify-end pb-0.5">
              {[
                { label: 'Awaiting you', value: incoming.length, color: 'var(--color-warning-text)' },
                { label: 'Overdue', value: overdueCount, color: 'var(--color-danger-500)' },
                { label: 'Sent and open', value: outgoing.length, color: 'var(--accent-primary)' },
              ].map(s => (
                <span key={s.label} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  {s.label} ({s.value.toLocaleString()})
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Direction is a property of the queue, not a filter on one list —
                the two sides answer different questions ("what must I decide?"
                vs "what am I still waiting on?"), so they get tabs. */}
            <div role="tablist" aria-label="Transfer direction" style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {([
                ['incoming', 'Awaiting you', incoming.length],
                ['outgoing', 'Sent by you', outgoing.length],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  style={{
                    height: 38, padding: '0 14px', borderRadius: 999,
                    border: '1px solid ' + (tab === key ? 'var(--accent-primary)' : 'var(--border-light)'),
                    background: tab === key ? 'var(--accent-primary)' : 'var(--bg-card-solid)',
                    color: tab === key ? 'var(--color-white)' : 'var(--text-secondary)',
                    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                  }}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by patient, reason, or ward…"
                style={{
                  padding: '9px 18px', height: 38, borderRadius: 999,
                  border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)',
                  fontSize: 13, color: 'var(--text-primary)', outline: 'none',
                }}
              />
            </div>
          </div>

          {error && (
            <div className="mt-2 text-[11.5px]" style={{ color: 'var(--color-danger-500)' }}>{error}</div>
          )}
        </div>

        {/* ── The list ── */}
        <div className="appointment-card-surface patients-list-surface">
          <div className="appointment-card-flow">
            {/* The column head is the queue's frame, not a label for whichever
                rows happen to be loaded — it stays put when a search matches
                nothing, so the list never collapses into a bare message. */}
            <div className="appointment-card-head" aria-hidden="true">
              <span>Patient</span>
              <span>Requested</span>
              <span>{tab === 'incoming' ? 'From' : 'To'}</span>
              <span>Reason</span>
              <span>Status</span>
            </div>

            {rows.length === 0 && (
              <div className="appointment-card-empty">
                {loading
                  ? 'Loading transfers…'
                  : search.trim()
                    ? 'No transfers match your search'
                    : tab === 'incoming'
                      ? 'No transfers are waiting on your decision'
                      : 'You have no open transfer requests'}
              </div>
            )}

            {rows.map(t => {
              const overdue = isTransferOverdue(t);
              const decide = auth ? canDecideTransfer(auth, t) : { allowed: false };
              const tone = STATUS_TONE[t.status] || STATUS_TONE.withdrawn;
              const counterparty = tab === 'incoming' ? t.from : t.to;
              return (
                <div
                  key={t._id}
                  className={`ehr-appointment-row appointment-card-row${overdue ? ' data-row--warning' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openChart(t)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChart(t); }
                  }}
                >
                  <div className="ehr-appointment-identity">
                    <span
                      aria-hidden="true"
                      style={{
                        width: 40, height: 40, borderRadius: 999, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: overdue ? 'rgba(224, 49, 39,0.12)' : 'var(--overlay-subtle)',
                        color: overdue ? 'var(--color-danger-500)' : 'var(--text-secondary)',
                        fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
                      }}
                    >
                      {initials(t.patientName)}
                    </span>
                    <div className="ehr-appointment-main appointment-card-patient">
                      <Link
                        href={`/patients/${t.patientId}?tab=referrals`}
                        onClick={e => e.stopPropagation()}
                      >
                        {t.patientName || 'Patient'}
                      </Link>
                      <p>{t.hospitalNumber || 'No hospital number'}</p>
                    </div>
                  </div>

                  <div className="ehr-appointment-time">
                    <strong>{formatWhen(t.requestedAt)}</strong>
                    <span style={overdue ? { color: 'var(--color-danger-500)' } : undefined}>
                      {overdue ? 'Overdue' : t.urgency ? `${t.urgency} priority` : 'Routine'}
                    </span>
                  </div>

                  <div className="ehr-appointment-time">
                    <strong>{describeAssignment(counterparty)}</strong>
                    <span>{tab === 'incoming' ? 'Sending team' : 'Receiving team'}</span>
                  </div>

                  <div className="ehr-appointment-time">
                    <strong style={{ fontWeight: 600 }}>{t.reason || 'No reason given'}</strong>
                    <span>{t.transferType ? String(t.transferType).replace(/_/g, ' ') : 'Transfer'}</span>
                  </div>

                  <div className="flex items-center gap-2 justify-end">
                    {tab === 'incoming' && decide.allowed ? (
                      <button
                        type="button"
                        className="btn btn-primary text-[11px] inline-flex items-center gap-1 flex-shrink-0"
                        disabled={busyId === t._id}
                        onClick={e => { e.stopPropagation(); accept(t); }}
                        title="Take responsibility for this patient"
                      >
                        <Check className="w-3 h-3" />
                        {busyId === t._id ? 'Accepting…' : 'Accept'}
                      </button>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                        style={{ background: tone.bg, color: tone.fg, textTransform: 'capitalize' }}
                      >
                        {t.status}
                      </span>
                    )}
                    {overdue
                      ? <Clock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-danger-500)' }} />
                      : <ArrowRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Where the rest of the transfer trail lives — the queue only carries
            what is still open. */}
        <div
          className="px-4 py-2 flex items-center gap-2 text-[11px] flex-shrink-0"
          style={{ borderTop: '1px solid var(--border-light)', color: 'var(--text-muted)' }}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>Decided and expired transfers stay on each patient&apos;s chart.</span>
          <button
            type="button"
            className="underline ms-auto"
            onClick={() => router.push('/notifications?type=transfer')}
          >
            View all transfer alerts
          </button>
        </div>
      </div>
    </main>
  );
}
