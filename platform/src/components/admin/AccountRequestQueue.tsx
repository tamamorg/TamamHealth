'use client';

/**
 * The approver's side of "Request account".
 *
 * One component for both tiers. It does not decide who sees what — the API
 * already returned only the requests this session may act on — so there is no
 * second, weaker copy of the routing rule here to drift out of step with the
 * server's. What differs by tier is only what the approver may *grant*: an
 * org_admin cannot hand out platform or national roles, and the server rejects
 * it if they try, so the picker hides those rather than offering a button that
 * always fails.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountRequestDoc, UserRole } from '@/lib/db-types';
import { getRoleConfig } from '@/lib/permissions';
import {
  PLATFORM_APPROVAL_ROLES, REQUESTABLE_ROLES, accountRequestRoleNeedsFacility,
} from '@/lib/account-request-roles';

interface Props {
  /** The signed-in approver's role — decides which roles may be granted. */
  viewerRole: UserRole;
  /**
   * Rendered inside a host tab that already names it: drops the panel's own
   * title and standfirst so the heading isn't said twice, and keeps only the
   * Pending / Decided toggle.
   */
  embedded?: boolean;
  /**
   * Reports how many requests are waiting, so the host tab can badge the
   * count without opening the panel — an unseen request is a person who
   * never gets access.
   */
  onCountsChange?: (counts: { pending: number; decided: number }) => void;
}

interface Granted {
  requestId: string;
  username: string;
  temporaryPassword: string;
}

interface FacilityOption { id: string; name: string; orgId: string }

function roleLabel(role: UserRole): string {
  try {
    return getRoleConfig(role).label;
  } catch {
    return role;
  }
}

export default function AccountRequestQueue({ viewerRole, embedded = false, onCountsChange }: Props) {
  const [requests, setRequests] = useState<AccountRequestDoc[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [granted, setGranted] = useState<Granted | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  // Per-row approver overrides. The person asking says what they do; the
  // administrator decides what they get.
  const [roleFor, setRoleFor] = useState<Record<string, UserRole>>({});
  const [facilityFor, setFacilityFor] = useState<Record<string, string>>({});
  const [noteFor, setNoteFor] = useState<Record<string, string>>({});

  const grantableRoles = REQUESTABLE_ROLES.filter(
    r => viewerRole === 'super_admin' || !PLATFORM_APPROVAL_ROLES.includes(r),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/account-requests', { credentials: 'same-origin' });
      if (!res.ok) {
        setError(res.status === 403 ? 'You are not permitted to review account requests.' : 'Could not load requests.');
        setRequests([]);
        return;
      }
      const body = await res.json();
      setRequests(body.requests ?? []);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account-requests/options')
      .then(res => (res.ok ? res.json() : { facilities: [] }))
      .then(body => { if (!cancelled) setFacilities(body.facilities ?? []); })
      .catch(() => { if (!cancelled) setFacilities([]); });
    return () => { cancelled = true; };
  }, []);

  const decide = async (doc: AccountRequestDoc, action: 'approve' | 'reject') => {
    setBusyId(doc._id);
    setError('');
    try {
      const grantedRole = roleFor[doc._id] ?? doc.requestedRole;
      const selectedFacilityId = facilityFor[doc._id] ?? doc.hospitalId ?? '';
      const selectedFacility = facilities.find(f => f.id === selectedFacilityId);
      if (action === 'approve' && accountRequestRoleNeedsFacility(grantedRole) && !selectedFacility) {
        setError('Choose a valid facility before approving this account.');
        return;
      }
      const res = await fetch(`/api/account-requests/${encodeURIComponent(doc._id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action,
          role: grantedRole,
          hospitalId: selectedFacility?.id,
          hospitalName: selectedFacility?.name,
          decisionNote: noteFor[doc._id],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not record that decision.');
        return;
      }
      if (action === 'approve' && body.temporaryPassword) {
        // Shown once. It is not stored in plaintext anywhere, so if the
        // approver loses it the only way forward is a password reset.
        setGranted({ requestId: doc._id, username: body.username, temporaryPassword: body.temporaryPassword });
      }
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusyId('');
    }
  };

  const pending = requests.filter(r => r.status === 'pending');
  const decided = requests.filter(r => r.status !== 'pending');
  const shown = showDecided ? decided : pending;

  // Held in a ref so an inline callback prop doesn't re-fire the effect on
  // every parent render — it reports only when the requests themselves change.
  const countsRef = useRef(onCountsChange);
  useEffect(() => { countsRef.current = onCountsChange; });
  useEffect(() => {
    countsRef.current?.({
      pending: requests.filter(r => r.status === 'pending').length,
      decided: requests.filter(r => r.status !== 'pending').length,
    });
  }, [requests]);

  return (
    <section
      className={`arq${embedded ? ' arq--embedded' : ''}`}
      aria-labelledby={embedded ? undefined : 'arq-title'}
      aria-label={embedded ? 'Account requests' : undefined}
    >
      <header className={`arq-head${embedded ? ' arq-head--bare' : ''}`}>
        {!embedded && (
          <div>
            <h2 id="arq-title" className="arq-title">Account requests</h2>
            <p className="arq-sub">
              {viewerRole === 'super_admin'
                ? 'Requests for platform and national roles, and any that named no organisation.'
                : 'People asking to join your organisation.'}
            </p>
          </div>
        )}
        <div className="arq-tabs" role="tablist">
          <button role="tab" aria-selected={!showDecided} className={`arq-tab${!showDecided ? ' is-on' : ''}`}
            onClick={() => setShowDecided(false)}>
            Pending{pending.length ? ` (${pending.length})` : ''}
          </button>
          <button role="tab" aria-selected={showDecided} className={`arq-tab${showDecided ? ' is-on' : ''}`}
            onClick={() => setShowDecided(true)}>
            Decided{decided.length ? ` (${decided.length})` : ''}
          </button>
        </div>
      </header>

      {error && <div role="alert" className="arq-error">{error}</div>}

      {granted && (
        <div role="status" className="arq-granted">
          <strong>Account created — {granted.username}</strong>
          <p>
            Give this one-time password to {granted.username}. They must change it when they first sign in.
            It is shown once and is not stored anywhere in readable form.
          </p>
          <code className="arq-password">{granted.temporaryPassword}</code>
          <button className="arq-btn arq-btn--quiet" onClick={() => setGranted(null)}>Done</button>
        </div>
      )}

      {/* The header row stays put on an empty list, so the columns are still
          legible and the empty message reads as "none of these" rather than
          as a broken panel. */}
      <div className="arq-row arq-row--head" aria-hidden="true">
        <span>Requester</span><span>Role</span><span>Where</span><span>Asked</span><span />
      </div>

      {loading ? (
        <p className="arq-empty">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="arq-empty">{showDecided ? 'Nothing decided yet.' : 'No requests waiting.'}</p>
      ) : (
        shown.map(doc => (
          <article key={doc._id} className="arq-item">
            <div className="arq-row">
              <span className="arq-who">
                <strong>{doc.fullName}</strong>
                <span className="arq-meta">{doc.email}{doc.phone ? ` · ${doc.phone}` : ''}</span>
              </span>
              <span>{roleLabel(doc.requestedRole)}</span>
              <span className="arq-meta">
                {doc.orgName || 'No organisation given'}
                {doc.hospitalName ? ` · ${doc.hospitalName}` : ''}
              </span>
              <span className="arq-meta">{(doc.createdAt || '').slice(0, 10)}</span>
              <span className={`arq-status arq-status--${doc.status}`}>{doc.status}</span>
            </div>

            {doc.note && <p className="arq-note">“{doc.note}”</p>}

            {doc.status === 'pending' ? (
              <div className="arq-actions">
                <label className="arq-ctl">
                  <span>Grant role</span>
                  <select value={roleFor[doc._id] ?? doc.requestedRole}
                    onChange={e => setRoleFor(m => ({ ...m, [doc._id]: e.target.value as UserRole }))}>
                    {grantableRoles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </label>
                <label className="arq-ctl">
                  <span>Facility</span>
                  <select
                    value={facilityFor[doc._id] ?? doc.hospitalId ?? ''}
                    disabled={!accountRequestRoleNeedsFacility(roleFor[doc._id] ?? doc.requestedRole)}
                    onChange={e => setFacilityFor(m => ({ ...m, [doc._id]: e.target.value }))}
                  >
                    <option value="">
                      {accountRequestRoleNeedsFacility(roleFor[doc._id] ?? doc.requestedRole)
                        ? 'Choose a facility…'
                        : 'Not required'}
                    </option>
                    {facilities
                      .filter(f => !doc.orgId || f.orgId === doc.orgId)
                      .map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label className="arq-ctl arq-ctl--wide">
                  <span>Note</span>
                  <input value={noteFor[doc._id] ?? ''}
                    placeholder="Recorded with the decision"
                    onChange={e => setNoteFor(m => ({ ...m, [doc._id]: e.target.value }))} />
                </label>
                <div className="arq-buttons">
                  <button className="arq-btn" disabled={busyId === doc._id}
                    onClick={() => decide(doc, 'approve')}>
                    {busyId === doc._id ? 'Working…' : 'Approve & create account'}
                  </button>
                  <button className="arq-btn arq-btn--quiet" disabled={busyId === doc._id}
                    onClick={() => decide(doc, 'reject')}>
                    Reject
                  </button>
                </div>
              </div>
            ) : (
              <p className="arq-meta arq-decided">
                {doc.status === 'approved'
                  ? `Approved by ${doc.decidedByName || doc.decidedBy} — account ${doc.createdUsername}`
                  : `Rejected by ${doc.decidedByName || doc.decidedBy}`}
                {doc.decisionNote ? ` · ${doc.decisionNote}` : ''}
              </p>
            )}
          </article>
        ))
      )}

      <style jsx>{`
        .arq { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
        /* Inside a tab the card supplies the surrounding room, so the panel
           stops reserving its own. */
        .arq--embedded { margin-bottom: 0; }
        .arq-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .arq-head--bare { justify-content: flex-end; }
        .arq-title { margin: 0; font-size: 17px; color: var(--text-primary); }
        .arq-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-muted); }
        .arq-tabs { display: flex; gap: 6px; }
        .arq-tab {
          appearance: none; border: 1px solid var(--border-light); background: transparent;
          padding: 6px 12px; border-radius: 999px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer;
        }
        .arq-tab.is-on { background: var(--overlay-subtle); color: var(--text-primary); font-weight: 600; }
        .arq-error {
          font-size: 13px; color: var(--color-danger); background: var(--color-danger-bg);
          border: 1px solid color-mix(in srgb, var(--color-danger) 22%, transparent);
          padding: 9px 12px; border-radius: 8px;
        }
        .arq-granted {
          display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
          padding: 14px 16px; border-radius: 10px;
          background: var(--overlay-subtle); border: 1px solid var(--border-light);
        }
        .arq-granted p { margin: 0; font-size: 13px; color: var(--text-secondary); }
        .arq-password {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px; letter-spacing: 0.04em;
          padding: 8px 12px; border: 1px solid var(--border-light); border-radius: 8px; background: var(--bg-card-solid);
          user-select: all;
        }
        .arq-row {
          display: grid; grid-template-columns: 1.6fr 1fr 1.6fr 0.7fr 0.8fr;
          gap: 12px; align-items: center; padding: 10px 0;
        }
        .arq-row--head {
          border-bottom: 1px solid var(--border-light); padding-bottom: 6px;
          font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted);
        }
        .arq-item { border-bottom: 1px solid var(--border-light); }
        .arq-who { display: flex; flex-direction: column; gap: 1px; }
        .arq-meta { font-size: 12.5px; color: var(--text-muted); }
        .arq-note { margin: 0 0 8px; font-size: 13px; color: var(--text-secondary); font-style: italic; }
        .arq-status { font-size: 12px; text-transform: capitalize; }
        .arq-status--pending { color: var(--text-muted); }
        .arq-status--approved { color: var(--color-success); }
        .arq-status--rejected { color: var(--color-danger); }
        .arq-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; padding: 0 0 14px; }
        .arq-ctl { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-muted); }
        .arq-ctl--wide { flex: 1; min-width: 180px; }
        .arq-ctl select, .arq-ctl input {
          padding: 8px 10px; font-size: 13.5px; color: var(--text-primary);
          background: var(--bg-card-solid); border: 1px solid var(--border-light); border-radius: 8px;
        }
        .arq-buttons { display: flex; gap: 8px; }
        .arq-btn {
          padding: 9px 16px; font-size: 13.5px; font-weight: 600; color: #0E2A4A; background: #E8863A;
          border: none; border-radius: 999px; cursor: pointer;
        }
        .arq-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .arq-btn--quiet { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-light); }
        .arq-empty { margin: 0; padding: 16px 0; font-size: 13.5px; color: var(--text-muted); }
        .arq-decided { padding-bottom: 12px; }
        @media (max-width: 860px) {
          .arq-row { grid-template-columns: 1fr 1fr; }
          .arq-row--head { display: none; }
        }
      `}</style>
    </section>
  );
}
